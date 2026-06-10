import { scanSkills, PROTECTED_SKILLS } from "./skills.js";
import { listProfiles, getProfile } from "./profiles.js";
import type { SkillInfo } from "./skills.js";

export interface ProfileSaving {
  name: string;
  /** Idle tokens that remain loaded when this profile is active. */
  activeTokens: number;
  /** Idle tokens this profile removes vs. having every skill enabled. */
  savedTokens: number;
  keptSkills: string[];
}

export interface Stats {
  skills: SkillInfo[];
  /** Idle tokens if every known skill were enabled (the worst case). */
  totalTokens: number;
  /** Idle tokens currently loaded (skills presently active). */
  currentActiveTokens: number;
  profiles: ProfileSaving[];
}

export async function computeStats(): Promise<Stats> {
  const skills = await scanSkills();
  const totalTokens = skills.reduce((sum, s) => sum + s.idleTokens, 0);
  const currentActiveTokens = skills
    .filter((s) => s.active)
    .reduce((sum, s) => sum + s.idleTokens, 0);

  const tokenByName = new Map(skills.map((s) => [s.name, s.idleTokens]));
  const allNames = new Set(skills.map((s) => s.name));

  const profileNames = await listProfiles();
  const profiles: ProfileSaving[] = [];
  for (const name of profileNames) {
    const profile = await getProfile(name);
    if (!profile) continue;
    const declared = profile.skills ?? [];
    // A profile with no declared skills leaves the skill set untouched.
    const kept = declared.length === 0
      ? [...allNames]
      : [...new Set([...declared, ...PROTECTED_SKILLS])].filter((s) => allNames.has(s));
    const activeTokens = kept.reduce((sum, s) => sum + (tokenByName.get(s) ?? 0), 0);
    profiles.push({
      name,
      activeTokens,
      savedTokens: totalTokens - activeTokens,
      keptSkills: kept.sort(),
    });
  }

  return { skills, totalTokens, currentActiveTokens, profiles };
}
