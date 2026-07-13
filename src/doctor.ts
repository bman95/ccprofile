import { existsSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths.js";
import { readJson } from "./config.js";
import { listEntries, ALL_KINDS } from "./items.js";
import { listProfiles, getProfile, getActiveProfile } from "./profiles.js";
import { getBaseline } from "./baseline.js";
import { getBindings } from "./bindings.js";
import { readLock, lockIsStale, LOCK_FILE } from "./lock.js";
import type { ClaudeSettings } from "./types.js";

export type CheckLevel = "ok" | "warn" | "fail";

export interface CheckResult {
  level: CheckLevel;
  message: string;
}

/**
 * Health checks for everything ccprofile depends on or manages. The tool is
 * coupled to Claude Code conventions it does not control, and its own state
 * (baseline, marker, bindings, lock) can drift after crashes or manual edits;
 * `doctor` makes both kinds of breakage visible instead of silent.
 */
export async function runDoctor(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const add = (level: CheckLevel, message: string) => results.push({ level, message });

  // Claude Code installation
  if (!existsSync(paths.claudeDir)) {
    add("fail", `~/.claude not found — is Claude Code installed?`);
    return results;
  }
  add("ok", "~/.claude exists");

  // Settings files parse
  const settingsFiles = new Set<string>([paths.settingsJson]);
  let baseline = null;
  try {
    baseline = await getBaseline();
  } catch (err) {
    add("fail", `Baseline file is unreadable: ${(err as Error).message}`);
  }
  if (baseline?.settingsPath) settingsFiles.add(baseline.settingsPath);
  for (const file of settingsFiles) {
    try {
      const settings = await readJson<ClaudeSettings>(file);
      add("ok", settings === null ? `${file} not present (fine)` : `${file} parses`);
    } catch (err) {
      add("fail", (err as Error).message);
    }
  }

  // Item collisions (same name active AND disabled — usually a crashed or
  // concurrent activation; the item's effective state is ambiguous)
  for (const spec of ALL_KINDS) {
    const active = new Set((await listEntries(spec.activeDir, spec.dirsOnly)).map((e) => e.name));
    const disabled = await listEntries(spec.disabledDir, spec.dirsOnly);
    const both = disabled.filter((e) => active.has(e.name)).map((e) => e.name);
    if (both.length > 0) {
      add(
        "warn",
        `${spec.label}(s) present in BOTH ${spec.activeDir} and ${spec.disabledDir}: ` +
          `${both.join(", ")} — resolve by deleting one copy of each`
      );
    } else {
      add("ok", `No ${spec.kind} active/disabled collisions`);
    }
  }

  // Profile files parse, and their items exist somewhere
  let profileNames: string[] = [];
  try {
    profileNames = await listProfiles();
  } catch (err) {
    add("fail", `Cannot list profiles: ${(err as Error).message}`);
  }
  const inventories = new Map<string, Set<string>>();
  for (const spec of ALL_KINDS) {
    inventories.set(spec.plural, new Set([
      ...(await listEntries(spec.activeDir, spec.dirsOnly)).map((e) => e.name),
      ...(await listEntries(spec.disabledDir, spec.dirsOnly)).map((e) => e.name),
    ]));
  }
  for (const name of profileNames) {
    try {
      const profile = await getProfile(name);
      if (!profile) continue;
      const missing: string[] = [];
      for (const spec of ALL_KINDS) {
        for (const item of profile[spec.plural] ?? []) {
          if (!inventories.get(spec.plural)!.has(item)) missing.push(`${spec.kind} "${item}"`);
        }
      }
      if (missing.length > 0) {
        add("warn", `Profile "${name}" references items not installed: ${missing.join(", ")}`);
      }
    } catch (err) {
      add("fail", `Profile "${name}" is unreadable: ${(err as Error).message}`);
    }
  }
  if (profileNames.length > 0) add("ok", `${profileNames.length} profile(s) parse`);

  // Active marker ↔ baseline consistency
  const active = await getActiveProfile().catch(() => null);
  if (active && !baseline) {
    add(
      "warn",
      `Profile "${active}" is marked active but no baseline exists — reset cannot ` +
        `restore the original state (it will fall back to enabling everything)`
    );
  } else if (!active && baseline) {
    add(
      "warn",
      `A baseline exists but no profile is marked active — a previous activation may ` +
        `have been interrupted; run "ccprofile reset" to restore the recorded state`
    );
  } else {
    add("ok", active ? `Active profile "${active}" has a baseline` : "No active profile, no baseline");
  }
  if (active && profileNames.length > 0 && !profileNames.includes(active)) {
    add("warn", `Active profile "${active}" no longer exists in ${paths.profilesDir}`);
  }

  // Bindings point at real profiles and directories
  const bindings = await getBindings().catch(() => ({} as Record<string, string>));
  for (const [dir, profile] of Object.entries(bindings)) {
    if (!profileNames.includes(profile)) {
      add("warn", `Binding ${dir} → "${profile}" points at a profile that does not exist`);
    }
    if (!existsSync(dir)) {
      add("warn", `Binding ${dir} → "${profile}" points at a directory that does not exist`);
    }
  }

  // Companion skill
  if (existsSync(join(paths.skillsDir, "ccprofile"))) {
    add("ok", "Companion /profile-edit skill installed");
  } else {
    add("warn", 'Companion /profile-edit skill not installed — run "ccprofile init"');
  }

  // Stale or live lock
  if (existsSync(LOCK_FILE)) {
    const info = await readLock();
    if (lockIsStale(info)) {
      add("warn", `Stale lock file at ${LOCK_FILE} (will be reclaimed automatically on next run)`);
    } else {
      add("warn", `Another ccprofile process (pid ${info!.pid}) currently holds the activation lock`);
    }
  } else {
    add("ok", "No activation lock held");
  }

  return results;
}
