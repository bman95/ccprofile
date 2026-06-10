import { existsSync } from "node:fs";
import { readdir, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./paths.js";
import { moveDir } from "./fsutil.js";

/**
 * Skills that must never be disabled by a profile. The companion skill powers
 * `/profile-edit`; disabling it would make profile management unreachable from
 * inside Claude Code. It is non-auto-invocable so it costs ~0 idle tokens.
 */
export const PROTECTED_SKILLS = ["ccprofile"];

/**
 * A toggleable context item. Skills are directories containing SKILL.md;
 * agents and slash commands are .md files (or namespace directories). All
 * three are loaded into the system prompt at session start, so all three are
 * worth toggling per profile.
 */
export interface ItemEntry {
  /** Logical name users refer to (file extension stripped). */
  name: string;
  /** Actual filesystem basename, used when moving. */
  base: string;
}

export interface KindSpec {
  kind: "skill" | "agent" | "command";
  label: string;
  /** Profile/baseline field name for this kind. */
  plural: "skills" | "agents" | "commands";
  activeDir: string;
  disabledDir: string;
  /** Skills are only ever directories; agents/commands may be .md files. */
  dirsOnly: boolean;
  /** Items never disabled by a profile. */
  protected: string[];
}

export const SKILL_KIND: KindSpec = {
  kind: "skill",
  label: "Skill",
  plural: "skills",
  activeDir: paths.skillsDir,
  disabledDir: paths.skillsDisabledDir,
  dirsOnly: true,
  protected: PROTECTED_SKILLS,
};

export const AGENT_KIND: KindSpec = {
  kind: "agent",
  label: "Agent",
  plural: "agents",
  activeDir: paths.agentsDir,
  disabledDir: paths.agentsDisabledDir,
  dirsOnly: false,
  protected: [],
};

export const COMMAND_KIND: KindSpec = {
  kind: "command",
  label: "Command",
  plural: "commands",
  activeDir: paths.commandsDir,
  disabledDir: paths.commandsDisabledDir,
  dirsOnly: false,
  protected: [],
};

export const ALL_KINDS: KindSpec[] = [SKILL_KIND, AGENT_KIND, COMMAND_KIND];

export async function listEntries(dir: string, dirsOnly: boolean): Promise<ItemEntry[]> {
  if (!existsSync(dir)) return [];
  const dirents = await readdir(dir, { withFileTypes: true });
  const entries: ItemEntry[] = [];
  for (const e of dirents) {
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        const s = await stat(join(dir, e.name));
        isDir = s.isDirectory();
        isFile = s.isFile();
      } catch {
        continue; // dangling symlink
      }
    }
    if (isDir) {
      entries.push({ name: e.name, base: e.name });
    } else if (!dirsOnly && isFile && e.name.endsWith(".md")) {
      entries.push({ name: e.name.slice(0, -3), base: e.name });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listItemNames(dir: string, dirsOnly: boolean): Promise<string[]> {
  return (await listEntries(dir, dirsOnly)).map((e) => e.name);
}

/**
 * Make the active set of a kind exactly match `targetNames` (plus protected
 * items): enable disabled items in the target, disable active items outside it.
 */
export async function syncItems(
  spec: KindSpec,
  targetNames: Set<string>,
  dryRun?: boolean,
  warnMissing?: string[]
): Promise<string[]> {
  const changes: string[] = [];
  const target = new Set([...targetNames, ...spec.protected]);

  if (!dryRun && !existsSync(spec.disabledDir)) {
    await mkdir(spec.disabledDir, { recursive: true });
  }

  const active = await listEntries(spec.activeDir, spec.dirsOnly);
  const disabled = await listEntries(spec.disabledDir, spec.dirsOnly);
  const known = new Set([...active, ...disabled].map((e) => e.name));

  for (const e of disabled) {
    if (target.has(e.name)) {
      const to = join(spec.activeDir, e.base);
      if (!existsSync(to)) {
        if (!dryRun) {
          if (!existsSync(spec.activeDir)) await mkdir(spec.activeDir, { recursive: true });
          await moveDir(join(spec.disabledDir, e.base), to);
        }
        changes.push(`${spec.label} enabled: ${e.name}`);
      }
    }
  }

  for (const e of active) {
    if (!target.has(e.name)) {
      const to = join(spec.disabledDir, e.base);
      if (!existsSync(to)) {
        if (!dryRun) {
          await moveDir(join(spec.activeDir, e.base), to);
        }
        changes.push(`${spec.label} disabled: ${e.name}`);
      }
    }
  }

  for (const name of warnMissing ?? []) {
    if (!known.has(name)) {
      changes.push(
        `Warning: ${spec.kind} "${name}" not found in ${spec.activeDir} or ${spec.disabledDir}`
      );
    }
  }

  return changes;
}
