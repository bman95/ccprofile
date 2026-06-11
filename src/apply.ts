import { paths } from "./paths.js";
import { readJson, writeJsonSafe } from "./config.js";
import { setActiveProfile, getProfile, clearActiveProfile } from "./profiles.js";
import { syncItems, listItemNames, ALL_KINDS, SKILL_KIND, AGENT_KIND, COMMAND_KIND } from "./items.js";
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

  const settingsPath = opts.projectDir
    ? paths.projectSettings(opts.projectDir)
    : paths.settingsJson;

  // Capture a restore point before the first mutation so reset is reversible.
  // The baseline remembers which settings file it captured, so reset restores
  // the same file this activation modifies.
  if (!opts.dryRun) {
    await ensureBaseline(settingsPath);
  }

  const changes: string[] = [];

  if (profile.plugins && Object.keys(profile.plugins).length > 0) {
    changes.push(...(await applyPlugins(settingsPath, profile.plugins, opts.dryRun)));
  }

  // Skills, agents, and commands all follow the same keep-list semantics:
  // an empty/absent list leaves that kind untouched.
  for (const spec of ALL_KINDS) {
    const keep = profile[spec.plural];
    if (keep && keep.length > 0) {
      changes.push(...(await syncItems(spec, new Set(keep), opts.dryRun, keep)));
    }
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
    // Precise restore to the captured environment. Baselines from v0.2 lack
    // the agent/command fields; for those, restore everything of that kind.
    const targets: Array<[typeof SKILL_KIND, string[] | undefined]> = [
      [SKILL_KIND, baseline.activeSkills],
      [AGENT_KIND, baseline.activeAgents],
      [COMMAND_KIND, baseline.activeCommands],
    ];
    for (const [spec, captured] of targets) {
      const target = captured ?? (await allKnownItems(spec));
      changes.push(...(await syncItems(spec, new Set(target), opts.dryRun)));
    }
    // Older baselines lack settingsPath; they were captured from the global file.
    changes.push(
      ...(await restoreSettings(
        baseline.settings,
        baseline.settingsPath ?? paths.settingsJson,
        opts.dryRun
      ))
    );

    if (!opts.dryRun) {
      await clearBaseline();
      await clearActiveProfile();
    }
    changes.push("Restored original environment (skills, agents, commands, plugins, MCP servers)");
  } else {
    // Legacy fallback: no baseline recorded — re-enable everything disabled.
    for (const spec of ALL_KINDS) {
      changes.push(...(await syncItems(spec, new Set(await allKnownItems(spec)), opts.dryRun)));
    }
    if (!opts.dryRun) await clearActiveProfile();
    changes.push("Profile cleared — all items restored");
  }

  return changes;
}

async function allKnownItems(spec: typeof SKILL_KIND): Promise<string[]> {
  return [
    ...(await listItemNames(spec.activeDir, spec.dirsOnly)),
    ...(await listItemNames(spec.disabledDir, spec.dirsOnly)),
  ];
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

/** Restore the captured slices of a settings file, removing keys absent at capture. */
async function restoreSettings(
  baseline: { enabledPlugins?: Record<string, boolean>; enabledMcpjsonServers?: string[]; disabledMcpjsonServers?: string[] },
  settingsPath: string,
  dryRun?: boolean
): Promise<string[]> {
  const changes: string[] = [];
  const settings = (await readJson<ClaudeSettings>(settingsPath)) ?? {};
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
    await writeJsonSafe(settingsPath, settings as Record<string, unknown>);
  }
  return changes;
}
