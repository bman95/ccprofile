import { scanSkills, scanAgents, scanCommands, PROTECTED_SKILLS } from "./skills.js";
import { listProfiles, getProfile } from "./profiles.js";
import type { SkillInfo } from "./skills.js";

export interface ProfileSaving {
  name: string;
  /** Idle tokens that remain loaded when this profile is active. */
  activeTokens: number;
  /** Idle tokens this profile removes vs. having every item enabled. */
  savedTokens: number;
  keptSkills: string[];
  keptAgents: string[];
  keptCommands: string[];
}

export interface Stats {
  /** Every known skill, agent, and slash command with its idle token cost. */
  items: SkillInfo[];
  /** Idle tokens if every known item were enabled (the worst case). */
  totalTokens: number;
  /** Idle tokens currently loaded (items presently active). */
  currentActiveTokens: number;
  profiles: ProfileSaving[];
}

export async function computeStats(): Promise<Stats> {
  const items = [
    ...(await scanSkills()),
    ...(await scanAgents()),
    ...(await scanCommands()),
  ];
  const totalTokens = items.reduce((sum, s) => sum + s.idleTokens, 0);
  const currentActiveTokens = items
    .filter((s) => s.active)
    .reduce((sum, s) => sum + s.idleTokens, 0);

  const byKind = (kind: SkillInfo["kind"]) => items.filter((i) => i.kind === kind);
  const tokensFor = (kind: SkillInfo["kind"], kept: string[]) => {
    const map = new Map(byKind(kind).map((i) => [i.name, i.idleTokens]));
    return kept.reduce((sum, n) => sum + (map.get(n) ?? 0), 0);
  };
  // A profile with an empty/absent list leaves that kind untouched → all stay.
  const keptOf = (kind: SkillInfo["kind"], declared: string[] | undefined, extra: string[] = []) => {
    const all = byKind(kind).map((i) => i.name);
    if (!declared || declared.length === 0) return all.sort();
    const allSet = new Set(all);
    return [...new Set([...declared, ...extra])].filter((n) => allSet.has(n)).sort();
  };

  const profileNames = await listProfiles();
  const profiles: ProfileSaving[] = [];
  for (const name of profileNames) {
    const profile = await getProfile(name);
    if (!profile) continue;
    const keptSkills = keptOf("skill", profile.skills, PROTECTED_SKILLS);
    const keptAgents = keptOf("agent", profile.agents);
    const keptCommands = keptOf("command", profile.commands);
    const activeTokens =
      tokensFor("skill", keptSkills) +
      tokensFor("agent", keptAgents) +
      tokensFor("command", keptCommands);
    profiles.push({
      name,
      activeTokens,
      savedTokens: totalTokens - activeTokens,
      keptSkills,
      keptAgents,
      keptCommands,
    });
  }

  return { items, totalTokens, currentActiveTokens, profiles };
}
