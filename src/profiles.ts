import { existsSync } from "node:fs";
import { readdir, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { paths } from "./paths.js";
import { readJson, writeJsonSafe } from "./config.js";
import type { Profile } from "./types.js";

async function ensureProfilesDir(): Promise<void> {
  if (!existsSync(paths.profilesDir)) {
    await mkdir(paths.profilesDir, { recursive: true });
  }
}

export async function listProfiles(): Promise<string[]> {
  await ensureProfilesDir();
  const entries = await readdir(paths.profilesDir);
  return entries
    .filter((e) => e.endsWith(".json"))
    .map((e) => e.replace(/\.json$/, ""))
    .sort();
}

export async function getProfile(name: string): Promise<Profile | null> {
  const filePath = paths.profileFile(name);
  return readJson<Profile>(filePath);
}

export async function saveProfile(profile: Profile): Promise<void> {
  await ensureProfilesDir();
  const filePath = paths.profileFile(profile.name);
  await writeJsonSafe(filePath, profile as unknown as Record<string, unknown>);
}

export async function deleteProfile(name: string): Promise<boolean> {
  const filePath = paths.profileFile(name);
  if (!existsSync(filePath)) return false;
  await rm(filePath);
  // Clear active marker if this was the active profile
  const active = await getActiveProfile();
  if (active === name) {
    await clearActiveProfile();
  }
  return true;
}

export async function getActiveProfile(): Promise<string | null> {
  try {
    const content = await readFile(paths.activeProfileFile, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
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
