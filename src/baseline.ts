import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { paths } from "./paths.js";
import { readJson, writeJsonSafe } from "./config.js";
import { listItemNames, SKILL_KIND, AGENT_KIND, COMMAND_KIND } from "./items.js";
import type { Baseline, ClaudeSettings } from "./types.js";

export async function getBaseline(): Promise<Baseline | null> {
  return readJson<Baseline>(paths.baselineFile);
}

export async function hasBaseline(): Promise<boolean> {
  return existsSync(paths.baselineFile);
}

/**
 * Build a snapshot of the current environment in memory, without writing it.
 * Used both to capture the real baseline on first activation and to compute
 * dry-run previews when no baseline exists yet (in which case the baseline
 * *would be* the current state, so the preview matches the real run).
 */
export async function buildBaseline(settingsPath: string = paths.settingsJson): Promise<Baseline> {
  const settings = (await readJson<ClaudeSettings>(settingsPath)) ?? {};
  return {
    capturedAt: new Date().toISOString(),
    activeSkills: await listItemNames(SKILL_KIND.activeDir, SKILL_KIND.dirsOnly),
    activeAgents: await listItemNames(AGENT_KIND.activeDir, AGENT_KIND.dirsOnly),
    activeCommands: await listItemNames(COMMAND_KIND.activeDir, COMMAND_KIND.dirsOnly),
    disabledSkills: await listItemNames(SKILL_KIND.disabledDir, SKILL_KIND.dirsOnly),
    disabledAgents: await listItemNames(AGENT_KIND.disabledDir, AGENT_KIND.dirsOnly),
    disabledCommands: await listItemNames(COMMAND_KIND.disabledDir, COMMAND_KIND.dirsOnly),
    settingsPath,
    settings: {
      ...(settings.enabledPlugins
        ? { enabledPlugins: { ...settings.enabledPlugins } }
        : {}),
      ...(settings.enabledMcpjsonServers
        ? { enabledMcpjsonServers: [...settings.enabledMcpjsonServers] }
        : {}),
      ...(settings.disabledMcpjsonServers
        ? { disabledMcpjsonServers: [...settings.disabledMcpjsonServers] }
        : {}),
    },
  };
}

export async function saveBaseline(baseline: Baseline): Promise<void> {
  await writeJsonSafe(paths.baselineFile, baseline as unknown as Record<string, unknown>);
}

export async function clearBaseline(): Promise<void> {
  if (existsSync(paths.baselineFile)) {
    await rm(paths.baselineFile);
  }
}
