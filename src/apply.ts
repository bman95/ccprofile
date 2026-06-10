import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./paths.js";
import { readJson, writeJsonSafe } from "./config.js";
import { setActiveProfile, getProfile, clearActiveProfile } from "./profiles.js";
import { moveDir } from "./fsutil.js";
import { listSkillDirs, PROTECTED_SKILLS } from "./skills.js";
import { ensureBaseline, getBaseline, clearBaseline } from "./baseline.js";
import type { ClaudeSettings } from "./types.js";

export interface ApplyOptions {
  projectDir?: string;
  dryRun?: boolean;
}

export async function applyProfile(
  name: string,
  opts: ApplyOptions = {}
): Promise<{ applied: string; changes: string[] }> {
  const profile = await getProfile(name);
  if (!profile) {
    throw new Error(`Profile "${name}" not found. Run "ccprofile list" to see available profiles.`);
  }

  // Capture a restore point before the first mutation so reset is reversible.
  if (!opts.dryRun) {
    await ensureBaseline();
  }

  const changes: string[] = [];

  const settingsPath = opts.projectDir
    ? paths.projectSettings(opts.projectDir)
    : paths.settingsJson;

  if (profile.plugins && Object.keys(profile.plugins).length > 0) {
    changes.push(...(await applyPlugins(settingsPath, profile.plugins, opts.dryRun)));
  }

  if (profile.skills && profile.skills.length > 0) {
    changes.push(...(await applySkills(profile.skills, opts.dryRun)));
  }

  if (profile.mcpServers && Object.keys(profile.mcpServers).length > 0) {
    changes.push(...(await applyMcpServers(settingsPath, profile.mcpServers, opts.dryRun)));
  }

  if (!opts.dryRun) {
    await setActiveProfile(name);
  }
  return { applied: name, changes };
}

export async function resetProfile(opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const changes: string[] = [];
  const baseline = await getBaseline();

  if (baseline) {
    // Precise restore to the captured environment.
    const target = new Set([...baseline.activeSkills, ...PROTECTED_SKILLS]);
    changes.push(...(await restoreSkills(target, opts.dryRun)));
    changes.push(...(await restoreSettings(baseline.settings, opts.dryRun)));

    if (!opts.dryRun) {
      await clearBaseline();
      await clearActiveProfile();
    }
    changes.push("Restored original environment (skills, plugins, MCP servers)");
  } else {
    // Legacy fallback: no baseline recorded — restore every disabled skill.
    const target = new Set([
      ...(await listSkillDirs(paths.skillsDir)),
      ...(await listSkillDirs(paths.skillsDisabledDir)),
    ]);
    changes.push(...(await restoreSkills(target, opts.dryRun)));
    if (!opts.dryRun) await clearActiveProfile();
    changes.push("Profile cleared — all skills restored");
  }

  return changes;
}

async function applyPlugins(
  settingsPath: string,
  plugins: Record<string, boolean>,
  dryRun?: boolean
): Promise<string[]> {
  const changes: string[] = [];
  const settings = (await readJson<ClaudeSettings>(settingsPath)) ?? {};
  const current = settings.enabledPlugins ?? {};

  for (const [plugin, enabled] of Object.entries(plugins)) {
    if (current[plugin] !== enabled) {
      current[plugin] = enabled;
      changes.push(`Plugin ${plugin}: ${enabled ? "enabled" : "disabled"}`);
    }
  }

  if (!dryRun && changes.length > 0) {
    settings.enabledPlugins = current;
    await writeJsonSafe(settingsPath, settings as Record<string, unknown>);
  }
  return changes;
}

async function applySkills(skills: string[], dryRun?: boolean): Promise<string[]> {
  // Desired active set is the profile's skills plus always-protected skills.
  const keep = new Set([...skills, ...PROTECTED_SKILLS]);
  return restoreSkills(keep, dryRun, { warnMissing: skills });
}

/**
 * Make the active skill set exactly match `target`: enable everything in the
 * set that is currently disabled, disable everything active that is not.
 */
async function restoreSkills(
  target: Set<string>,
  dryRun?: boolean,
  opts: { warnMissing?: string[] } = {}
): Promise<string[]> {
  const changes: string[] = [];

  if (!dryRun && !existsSync(paths.skillsDisabledDir)) {
    await mkdir(paths.skillsDisabledDir, { recursive: true });
  }

  const active = await listSkillDirs(paths.skillsDir);
  const disabled = await listSkillDirs(paths.skillsDisabledDir);
  const known = new Set([...active, ...disabled]);

  for (const skill of target) {
    if (disabled.includes(skill)) {
      if (!dryRun) {
        await moveDir(join(paths.skillsDisabledDir, skill), join(paths.skillsDir, skill));
      }
      changes.push(`Skill enabled: ${skill}`);
    }
  }

  for (const skill of active) {
    if (!target.has(skill)) {
      const to = join(paths.skillsDisabledDir, skill);
      if (!existsSync(to)) {
        if (!dryRun) {
          await moveDir(join(paths.skillsDir, skill), to);
        }
        changes.push(`Skill disabled: ${skill}`);
      }
    }
  }

  for (const skill of opts.warnMissing ?? []) {
    if (!known.has(skill)) {
      changes.push(`Warning: skill "${skill}" not found in ~/.claude/skills or skills-disabled`);
    }
  }

  return changes;
}

async function applyMcpServers(
  settingsPath: string,
  servers: Record<string, boolean>,
  dryRun?: boolean
): Promise<string[]> {
  const changes: string[] = [];
  const settings = (await readJson<ClaudeSettings>(settingsPath)) ?? {};

  const enabled = new Set(settings.enabledMcpjsonServers ?? []);
  const disabled = new Set(settings.disabledMcpjsonServers ?? []);

  for (const [server, shouldEnable] of Object.entries(servers)) {
    if (shouldEnable) {
      if (!enabled.has(server)) {
        enabled.add(server);
        changes.push(`MCP server enabled: ${server}`);
      }
      disabled.delete(server);
    } else {
      if (!disabled.has(server)) {
        disabled.add(server);
        changes.push(`MCP server disabled: ${server}`);
      }
      enabled.delete(server);
    }
  }

  if (!dryRun && changes.length > 0) {
    if (enabled.size > 0) settings.enabledMcpjsonServers = [...enabled];
    else delete settings.enabledMcpjsonServers;

    if (disabled.size > 0) settings.disabledMcpjsonServers = [...disabled];
    else delete settings.disabledMcpjsonServers;

    await writeJsonSafe(settingsPath, settings as Record<string, unknown>);
  }
  return changes;
}

/** Restore the captured slices of settings.json, removing keys absent at capture. */
async function restoreSettings(
  baseline: { enabledPlugins?: Record<string, boolean>; enabledMcpjsonServers?: string[]; disabledMcpjsonServers?: string[] },
  dryRun?: boolean
): Promise<string[]> {
  const changes: string[] = [];
  const settings = (await readJson<ClaudeSettings>(paths.settingsJson)) ?? {};
  let touched = false;

  const keys = ["enabledPlugins", "enabledMcpjsonServers", "disabledMcpjsonServers"] as const;
  for (const key of keys) {
    const before = JSON.stringify(settings[key] ?? null);
    const after = JSON.stringify(baseline[key] ?? null);
    if (before !== after) {
      if (baseline[key] === undefined) {
        delete settings[key];
      } else {
        (settings as Record<string, unknown>)[key] = baseline[key];
      }
      touched = true;
      changes.push(`Restored ${key}`);
    }
  }

  if (!dryRun && touched) {
    await writeJsonSafe(paths.settingsJson, settings as Record<string, unknown>);
  }
  return changes;
}
