import { paths } from "./paths.js";
import { readJson, writeJsonSafe } from "./config.js";
import { setActiveProfile, getProfile, clearActiveProfile } from "./profiles.js";
import {
  syncItems,
  restoreItems,
  listItemNames,
  ALL_KINDS,
  SKILL_KIND,
  AGENT_KIND,
  COMMAND_KIND,
} from "./items.js";
import { getBaseline, buildBaseline, saveBaseline, clearBaseline } from "./baseline.js";
import { CliError } from "./errors.js";
import type { Baseline, ClaudeSettings, Profile } from "./types.js";

export interface ApplyOptions {
  projectDir?: string;
  dryRun?: boolean;
}

/**
 * Activation is declarative: the desired environment is a pure function of
 * (baseline, profile). Plugin/MCP state is computed as the baseline overlaid
 * with the profile's toggles, so switching from profile A to profile B reverts
 * A's toggles instead of accumulating them. Keys ccprofile never touched (e.g.
 * a plugin installed while a profile was active) keep their current value.
 */
export async function applyProfile(
  name: string,
  opts: ApplyOptions = {}
): Promise<{ applied: string; changes: string[] }> {
  const profile = await getProfile(name);
  if (!profile) {
    throw new CliError(`Profile "${name}" not found. Run "ccprofile list" to see available profiles.`);
  }

  const settingsPath = opts.projectDir
    ? paths.projectSettings(opts.projectDir)
    : paths.settingsJson;

  // The baseline holds a single settings file. If a profile is already active
  // against one settings target (e.g. a project settings.json via --project),
  // activating another profile against a *different* target (e.g. the global
  // settings.json) would let reset restore only one of them, silently leaving
  // the other's plugin/MCP changes in place. Refuse that mix before mutating so
  // the reversibility guarantee holds; the user can reset first and switch.
  const existing = await getBaseline();
  if (!opts.dryRun && existing) {
    const baselinePath = existing.settingsPath ?? paths.settingsJson;
    if (baselinePath !== settingsPath) {
      throw new CliError(
        `A profile is already active against ${baselinePath}, but this activation ` +
          `targets ${settingsPath}. Mixing project and global targets would make ` +
          `reset unable to fully restore both. Run "ccprofile reset" first, then ` +
          `activate against the new target.`
      );
    }
  }

  // Capture a restore point before the first mutation so reset is reversible.
  // With no baseline yet, the baseline *is* the current state, so building it
  // in memory keeps dry-run previews identical to a real first activation.
  const baseline = existing ?? (await buildBaseline(settingsPath));
  if (!opts.dryRun && !existing) {
    await saveBaseline(baseline);
  }

  const changes: string[] = [];

  // Skills, agents, and commands: an absent list leaves that kind untouched;
  // a present list (including []) makes the active set exactly match it, plus
  // protected items. (Legacy profiles' empty lists are dropped on load.)
  for (const spec of ALL_KINDS) {
    const keep = profile[spec.plural];
    if (keep !== undefined) {
      changes.push(...(await syncItems(spec, new Set(keep), opts.dryRun, keep)));
    }
  }

  changes.push(...(await reconcileSettings(settingsPath, baseline, profile, opts.dryRun)));

  if (!opts.dryRun) {
    // Remember every plugin/MCP key any profile has touched since the baseline
    // was captured, so keys a profile introduced (absent at capture) can be
    // removed again on switch or reset.
    baseline.managedPlugins = union(baseline.managedPlugins, Object.keys(profile.plugins ?? {}));
    baseline.managedMcpServers = union(
      baseline.managedMcpServers,
      Object.keys(profile.mcpServers ?? {})
    );
    await saveBaseline(baseline);
    await setActiveProfile(name);
  }
  return { applied: name, changes };
}

export async function resetProfile(opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const changes: string[] = [];
  const baseline = await getBaseline();

  if (baseline) {
    // Restore only what the baseline recorded. Items installed while a profile
    // was active are unknown to the baseline and stay untouched (and enabled).
    // Baselines from v0.2 lack the agent/command fields; for those, re-enable
    // everything of that kind. Baselines before v0.4 lack the disabled lists;
    // for those nothing is force-disabled.
    const targets: Array<[typeof SKILL_KIND, string[] | undefined, string[] | undefined]> = [
      [SKILL_KIND, baseline.activeSkills, baseline.disabledSkills],
      [AGENT_KIND, baseline.activeAgents, baseline.disabledAgents],
      [COMMAND_KIND, baseline.activeCommands, baseline.disabledCommands],
    ];
    for (const [spec, active, disabled] of targets) {
      const target = active ?? (await allKnownItems(spec));
      changes.push(...(await restoreItems(spec, target, disabled, opts.dryRun)));
    }

    // Settings restore is just "reconcile against an empty profile": every
    // baseline key returns to its captured value, every profile-introduced
    // (managed, not in baseline) key is removed, unknown keys keep their value.
    changes.push(
      ...(await reconcileSettings(
        baseline.settingsPath ?? paths.settingsJson,
        baseline,
        {},
        opts.dryRun
      ))
    );

    if (!opts.dryRun) {
      await clearBaseline();
      await clearActiveProfile();
    }
    changes.push(
      opts.dryRun
        ? "Would restore original environment (skills, agents, commands, plugins, MCP servers)"
        : "Restored original environment (skills, agents, commands, plugins, MCP servers)"
    );
  } else {
    // Legacy fallback: no baseline recorded — re-enable everything disabled.
    for (const spec of ALL_KINDS) {
      changes.push(...(await syncItems(spec, new Set(await allKnownItems(spec)), opts.dryRun)));
    }
    if (!opts.dryRun) await clearActiveProfile();
    changes.push(
      opts.dryRun ? "Would clear profile — all items restored" : "Profile cleared — all items restored"
    );
  }

  return changes;
}

async function allKnownItems(spec: typeof SKILL_KIND): Promise<string[]> {
  return [
    ...(await listItemNames(spec.activeDir, spec.dirsOnly)),
    ...(await listItemNames(spec.disabledDir, spec.dirsOnly)),
  ];
}

function union(a: string[] | undefined, b: string[]): string[] {
  return [...new Set([...(a ?? []), ...b])].sort();
}

/**
 * Compute the desired plugin/MCP state (baseline overlaid with the profile's
 * toggles), diff it against the settings file, and write the result in a
 * single read-modify-write (one backup per activation instead of two).
 */
async function reconcileSettings(
  settingsPath: string,
  baseline: Baseline,
  profile: Pick<Profile, "plugins" | "mcpServers">,
  dryRun?: boolean
): Promise<string[]> {
  const changes: string[] = [];
  const settings = (await readJson<ClaudeSettings>(settingsPath)) ?? {};

  // --- Plugins ---
  const currentPlugins = settings.enabledPlugins ?? {};
  const baselinePlugins = baseline.settings.enabledPlugins ?? {};
  const desiredPlugins: Record<string, boolean> = { ...currentPlugins };
  for (const [k, v] of Object.entries(baselinePlugins)) desiredPlugins[k] = v;
  for (const k of baseline.managedPlugins ?? []) {
    if (!(k in baselinePlugins)) delete desiredPlugins[k];
  }
  for (const [k, v] of Object.entries(profile.plugins ?? {})) desiredPlugins[k] = v;

  for (const k of new Set([...Object.keys(currentPlugins), ...Object.keys(desiredPlugins)])) {
    if (currentPlugins[k] !== desiredPlugins[k]) {
      changes.push(
        k in desiredPlugins
          ? `Plugin ${k}: ${desiredPlugins[k] ? "enabled" : "disabled"}`
          : `Plugin ${k}: removed (was not present before profiles were applied)`
      );
    }
  }

  // --- MCP servers ---
  const currentEnabled = new Set(settings.enabledMcpjsonServers ?? []);
  const currentDisabled = new Set(settings.disabledMcpjsonServers ?? []);
  const baselineEnabled = new Set(baseline.settings.enabledMcpjsonServers ?? []);
  const baselineDisabled = new Set(baseline.settings.disabledMcpjsonServers ?? []);

  const desiredEnabled = new Set(currentEnabled);
  const desiredDisabled = new Set(currentDisabled);
  for (const s of baselineEnabled) {
    desiredEnabled.add(s);
    desiredDisabled.delete(s);
  }
  for (const s of baselineDisabled) {
    if (!baselineEnabled.has(s)) {
      desiredDisabled.add(s);
      desiredEnabled.delete(s);
    }
  }
  for (const s of baseline.managedMcpServers ?? []) {
    if (!baselineEnabled.has(s) && !baselineDisabled.has(s)) {
      desiredEnabled.delete(s);
      desiredDisabled.delete(s);
    }
  }
  for (const [s, enable] of Object.entries(profile.mcpServers ?? {})) {
    if (enable) {
      desiredEnabled.add(s);
      desiredDisabled.delete(s);
    } else {
      desiredDisabled.add(s);
      desiredEnabled.delete(s);
    }
  }

  const allServers = new Set([
    ...currentEnabled,
    ...currentDisabled,
    ...desiredEnabled,
    ...desiredDisabled,
  ]);
  for (const s of allServers) {
    const was = currentEnabled.has(s) ? "enabled" : currentDisabled.has(s) ? "disabled" : "unlisted";
    const now = desiredEnabled.has(s) ? "enabled" : desiredDisabled.has(s) ? "disabled" : "unlisted";
    if (was !== now) {
      changes.push(
        now === "unlisted"
          ? `MCP server ${s}: removed from lists (was not present before profiles were applied)`
          : `MCP server ${now}: ${s}`
      );
    }
  }

  if (!dryRun && changes.length > 0) {
    if (Object.keys(desiredPlugins).length > 0) settings.enabledPlugins = desiredPlugins;
    else delete settings.enabledPlugins;

    if (desiredEnabled.size > 0) settings.enabledMcpjsonServers = [...desiredEnabled].sort();
    else delete settings.enabledMcpjsonServers;

    if (desiredDisabled.size > 0) settings.disabledMcpjsonServers = [...desiredDisabled].sort();
    else delete settings.disabledMcpjsonServers;

    await writeJsonSafe(settingsPath, settings as Record<string, unknown>);
  }
  return changes;
}
