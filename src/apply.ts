import { existsSync } from "node:fs";
import { rename, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./paths.js";
import { readJson, writeJsonSafe } from "./config.js";
import { getProfile, setActiveProfile, getActiveProfile, clearActiveProfile } from "./profiles.js";
import type { ClaudeSettings, Profile } from "./types.js";

export interface ApplyOptions {
  projectDir?: string;
}

export async function applyProfile(
  name: string,
  opts: ApplyOptions = {}
): Promise<{ applied: string; changes: string[] }> {
  const profile = await getProfile(name);
  if (!profile) {
    throw new Error(`Profile "${name}" not found. Run "ccprofile list" to see available profiles.`);
  }

  const changes: string[] = [];

  // 1. Toggle plugins in settings.json
  if (profile.plugins && Object.keys(profile.plugins).length > 0) {
    const settingsPath = opts.projectDir
      ? paths.projectSettings(opts.projectDir)
      : paths.settingsJson;

    const pluginChanges = await applyPlugins(settingsPath, profile.plugins);
    changes.push(...pluginChanges);
  }

  // 2. Toggle skills (move folders)
  if (profile.skills && profile.skills.length > 0) {
    const skillChanges = await applySkills(profile.skills);
    changes.push(...skillChanges);
  }

  // 3. Toggle MCP servers
  if (profile.mcpServers && Object.keys(profile.mcpServers).length > 0) {
    const settingsPath = opts.projectDir
      ? paths.projectSettings(opts.projectDir)
      : paths.settingsJson;

    const mcpChanges = await applyMcpServers(settingsPath, profile.mcpServers);
    changes.push(...mcpChanges);
  }

  await setActiveProfile(name);
  return { applied: name, changes };
}

export async function resetProfile(): Promise<string[]> {
  const changes: string[] = [];

  // Move all disabled skills back to active
  if (existsSync(paths.skillsDisabledDir)) {
    const disabled = await readdir(paths.skillsDisabledDir);
    for (const skill of disabled) {
      const from = join(paths.skillsDisabledDir, skill);
      const to = join(paths.skillsDir, skill);
      if (!existsSync(to)) {
        await rename(from, to);
        changes.push(`Restored skill: ${skill}`);
      }
    }
  }

  await clearActiveProfile();
  changes.push("Profile cleared — all skills restored");
  return changes;
}

async function applyPlugins(
  settingsPath: string,
  plugins: Record<string, boolean>
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

  settings.enabledPlugins = current;
  await writeJsonSafe(settingsPath, settings as Record<string, unknown>);
  return changes;
}

async function applySkills(skills: string[]): Promise<string[]> {
  const changes: string[] = [];

  if (!existsSync(paths.skillsDisabledDir)) {
    await mkdir(paths.skillsDisabledDir, { recursive: true });
  }

  // Get all currently active skills
  const activeSkills = existsSync(paths.skillsDir)
    ? await readdir(paths.skillsDir)
    : [];

  // Get all currently disabled skills
  const disabledSkills = await readdir(paths.skillsDisabledDir);

  // Enable skills that should be active (move from disabled to active)
  for (const skill of skills) {
    if (disabledSkills.includes(skill)) {
      const from = join(paths.skillsDisabledDir, skill);
      const to = join(paths.skillsDir, skill);
      await rename(from, to);
      changes.push(`Skill enabled: ${skill}`);
    }
  }

  // Disable skills that should NOT be active (move from active to disabled)
  for (const skill of activeSkills) {
    if (!skills.includes(skill)) {
      const from = join(paths.skillsDir, skill);
      const to = join(paths.skillsDisabledDir, skill);
      if (!existsSync(to)) {
        await rename(from, to);
        changes.push(`Skill disabled: ${skill}`);
      }
    }
  }

  return changes;
}

async function applyMcpServers(
  settingsPath: string,
  servers: Record<string, boolean>
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

  if (enabled.size > 0) settings.enabledMcpjsonServers = [...enabled];
  else delete settings.enabledMcpjsonServers;

  if (disabled.size > 0) settings.disabledMcpjsonServers = [...disabled];
  else delete settings.disabledMcpjsonServers;

  await writeJsonSafe(settingsPath, settings as Record<string, unknown>);
  return changes;
}
