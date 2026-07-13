import { existsSync } from "node:fs";
import { readdir, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { paths } from "./paths.js";
import { readJson, writeJsonSafe } from "./config.js";
import { assertValidProfileName } from "./validate.js";
import { retargetBindings, removeBindingsFor } from "./bindings.js";
import { CliError } from "./errors.js";
import { PROFILE_VERSION, type Profile } from "./types.js";

async function ensureProfilesDir(): Promise<void> {
  if (!existsSync(paths.profilesDir)) {
    await mkdir(paths.profilesDir, { recursive: true });
  }
}

/**
 * Normalize a profile loaded from disk or import. Legacy profiles (schema
 * version < 2) used an empty list to mean "leave this kind untouched"; since
 * v2 an empty list means "disable everything of this kind", so legacy empty
 * lists are dropped to preserve their original meaning.
 */
export function normalizeProfile(profile: Profile): Profile {
  if ((profile.version ?? 1) < PROFILE_VERSION) {
    for (const key of ["skills", "agents", "commands"] as const) {
      if (Array.isArray(profile[key]) && profile[key]!.length === 0) {
        delete profile[key];
      }
    }
  }
  return profile;
}

export async function listProfiles(): Promise<string[]> {
  await ensureProfilesDir();
  const entries = await readdir(paths.profilesDir);
  return entries
    .filter((e) => e.endsWith(".json") && !e.startsWith("."))
    .map((e) => e.replace(/\.json$/, ""))
    .sort();
}

export async function getProfile(name: string): Promise<Profile | null> {
  assertValidProfileName(name);
  const filePath = paths.profileFile(name);
  const profile = await readJson<Profile>(filePath);
  return profile ? normalizeProfile(profile) : null;
}

export async function saveProfile(profile: Profile): Promise<void> {
  assertValidProfileName(profile.name);
  await ensureProfilesDir();
  profile.version = PROFILE_VERSION;
  const filePath = paths.profileFile(profile.name);
  await writeJsonSafe(filePath, profile as unknown as Record<string, unknown>);
}

export async function renameProfile(from: string, to: string): Promise<void> {
  assertValidProfileName(from);
  assertValidProfileName(to);
  const fromPath = paths.profileFile(from);
  const toPath = paths.profileFile(to);
  if (!existsSync(fromPath)) {
    throw new CliError(`Profile "${from}" not found.`);
  }
  if (existsSync(toPath)) {
    throw new CliError(`Profile "${to}" already exists.`);
  }
  const profile = (await readJson<Profile>(fromPath))!;
  profile.name = to;
  await writeJsonSafe(toPath, profile as unknown as Record<string, unknown>);
  await rm(fromPath);
  if ((await getActiveProfile()) === from) {
    await setActiveProfile(to);
  }
  await retargetBindings(from, to);
}

export async function deleteProfile(name: string): Promise<boolean> {
  assertValidProfileName(name);
  const filePath = paths.profileFile(name);
  if (!existsSync(filePath)) return false;
  await rm(filePath);
  // Clear active marker if this was the active profile
  const active = await getActiveProfile();
  if (active === name) {
    await clearActiveProfile();
  }
  await removeBindingsFor(name);
  return true;
}

export async function getActiveProfile(): Promise<string | null> {
  try {
    const content = await readFile(paths.activeProfileFile, "utf-8");
    return content.trim() || null;
  } catch (err) {
    // A missing marker means "no active profile"; anything else (e.g. a
    // permission error) must surface rather than masquerade as inactive.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function setActiveProfile(name: string): Promise<void> {
  await ensureProfilesDir();
  await writeFile(paths.activeProfileFile, name, "utf-8");
}

export async function clearActiveProfile(): Promise<void> {
  if (existsSync(paths.activeProfileFile)) {
    await rm(paths.activeProfileFile);
  }
}
