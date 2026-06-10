import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./paths.js";

export interface SkillInfo {
  name: string;
  active: boolean;
  description: string;
  /**
   * Estimated tokens this skill costs in the *idle* system prompt. Claude Code
   * loads each skill's metadata (name + description) on every turn until the
   * skill is actually invoked, so this metadata size is the recurring cost a
   * profile can eliminate by disabling the skill.
   */
  idleTokens: number;
}

const CHARS_PER_TOKEN = 4;

/**
 * Skills that must never be disabled by a profile. The companion skill powers
 * `/profile-edit`; disabling it would make profile management unreachable from
 * inside Claude Code. It is non-auto-invocable so it costs ~0 idle tokens.
 */
export const PROTECTED_SKILLS = ["ccprofile"];

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Extract the YAML frontmatter block (between the first pair of `---` lines). */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      let value = kv[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[kv[1]] = value;
    }
  }
  return out;
}

async function readSkillMeta(
  dir: string,
  name: string
): Promise<{ description: string; idleTokens: number }> {
  const skillMd = join(dir, name, "SKILL.md");
  try {
    const content = await readFile(skillMd, "utf-8");
    const fm = parseFrontmatter(content);
    // Skills with disable-model-invocation are not auto-loaded into the system
    // prompt, so they cost ~0 idle tokens.
    const disabled =
      (fm["disable-model-invocation"] ?? "").toLowerCase() === "true";
    const meta = `${fm.name ?? name}: ${fm.description ?? ""}`;
    return {
      description: fm.description ?? "",
      idleTokens: disabled ? 0 : estimateTokens(meta),
    };
  } catch {
    return { description: "", idleTokens: 0 };
  }
}

/** List skill directory names in a given location. */
export async function listSkillDirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      names.push(e.name);
    } else if (e.isSymbolicLink()) {
      // Follow symlinks that point at directories.
      try {
        if ((await stat(join(dir, e.name))).isDirectory()) names.push(e.name);
      } catch {
        /* dangling symlink — skip */
      }
    }
  }
  return names.sort();
}

/** Inventory every skill (active + disabled) with token estimates. */
export async function scanSkills(): Promise<SkillInfo[]> {
  const active = await listSkillDirs(paths.skillsDir);
  const disabled = await listSkillDirs(paths.skillsDisabledDir);

  const infos: SkillInfo[] = [];
  for (const name of active) {
    const meta = await readSkillMeta(paths.skillsDir, name);
    infos.push({ name, active: true, ...meta });
  }
  for (const name of disabled) {
    const meta = await readSkillMeta(paths.skillsDisabledDir, name);
    infos.push({ name, active: false, ...meta });
  }
  return infos.sort((a, b) => a.name.localeCompare(b.name));
}
