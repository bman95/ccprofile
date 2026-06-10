import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { paths } from "./paths.js";
import { readJson, writeJsonSafe } from "./config.js";
import { listSkillDirs } from "./skills.js";
import type { Baseline, ClaudeSettings } from "./types.js";

export async function getBaseline(): Promise<Baseline | null> {
  return readJson<Baseline>(paths.baselineFile);
}

export async function hasBaseline(): Promise<boolean> {
  return existsSync(paths.baselineFile);
}

/**
 * Capture the current environment as the restore point. Only called when there
 * is no baseline yet, so we never overwrite the user's true original state when
 * switching between profiles.
 */
export async function captureBaseline(): Promise<Baseline> {
  const settings = (await readJson<ClaudeSettings>(paths.settingsJson)) ?? {};
  const baseline: Baseline = {
    capturedAt: new Date().toISOString(),
    activeSkills: await listSkillDirs(paths.skillsDir),
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
  await writeJsonSafe(paths.baselineFile, baseline as unknown as Record<string, unknown>);
  return baseline;
}

/** Capture a baseline only if one does not already exist. */
export async function ensureBaseline(): Promise<void> {
  if (!(await hasBaseline())) {
    await captureBaseline();
  }
}

export async function clearBaseline(): Promise<void> {
  if (existsSync(paths.baselineFile)) {
    await rm(paths.baselineFile);
  }
}
