import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./paths.js";
import { listEntries, AGENT_KIND, COMMAND_KIND, type KindSpec } from "./items.js";

export { PROTECTED_SKILLS } from "./items.js";

export interface SkillInfo {
  name: string;
  kind: "skill" | "agent" | "command";
  active: boolean;
  description: string;
  /**
   * Estimated tokens this item costs in the *idle* system prompt. Claude Code
   * loads each skill/agent/command's metadata (name + description) on every
   * turn until it is actually invoked, so this metadata size is the recurring
   * cost a profile can eliminate by disabling the item.
   */
  idleTokens: number;
}

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Extract the YAML frontmatter block (between the first pair of `---` lines).
 * Only single-line `key: value` pairs are parsed; folded/multi-line YAML
 * values are ignored, which slightly undercounts the token estimate.
 */
export function parseFrontmatter(content: string): Record<string, string> {
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

function metaCost(name: string, fm: Record<string, string>): { description: string; idleTokens: number } {
  // Items with disable-model-invocation are not auto-loaded into the system
  // prompt, so they cost ~0 idle tokens.
  const disabled = (fm["disable-model-invocation"] ?? "").toLowerCase() === "true";
  const meta = `${fm.name ?? name}: ${fm.description ?? ""}`;
  return {
    description: fm.description ?? "",
    idleTokens: disabled ? 0 : estimateTokens(meta),
  };
}

async function readMdMeta(filePath: string, name: string): Promise<{ description: string; idleTokens: number }> {
  try {
    const content = await readFile(filePath, "utf-8");
    return metaCost(name, parseFrontmatter(content));
  } catch {
    return { description: "", idleTokens: 0 };
  }
}

/** Sum the metadata cost of every .md file under a directory (recursively). */
async function dirMdCost(dir: string): Promise<number> {
  let total = 0;
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of dirents) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      total += await dirMdCost(full);
    } else if (e.isFile() && e.name.endsWith(".md")) {
      total += (await readMdMeta(full, e.name.slice(0, -3))).idleTokens;
    }
  }
  return total;
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
  const infos: SkillInfo[] = [];
  for (const [dir, active] of [
    [paths.skillsDir, true],
    [paths.skillsDisabledDir, false],
  ] as const) {
    for (const name of await listSkillDirs(dir)) {
      const meta = await readMdMeta(join(dir, name, "SKILL.md"), name);
      infos.push({ name, kind: "skill", active, ...meta });
    }
  }
  return infos.sort((a, b) => a.name.localeCompare(b.name));
}

/** Inventory agents or slash commands (files or namespace dirs) with token estimates. */
export async function scanFileItems(spec: KindSpec): Promise<SkillInfo[]> {
  const infos: SkillInfo[] = [];
  for (const [dir, active] of [
    [spec.activeDir, true],
    [spec.disabledDir, false],
  ] as const) {
    for (const entry of await listEntries(dir, spec.dirsOnly)) {
      const full = join(dir, entry.base);
      if (entry.base.endsWith(".md")) {
        const meta = await readMdMeta(full, entry.name);
        infos.push({ name: entry.name, kind: spec.kind, active, ...meta });
      } else {
        // Namespace directory: cost is the sum of all .md files inside.
        infos.push({
          name: entry.name,
          kind: spec.kind,
          active,
          description: "",
          idleTokens: await dirMdCost(full),
        });
      }
    }
  }
  return infos.sort((a, b) => a.name.localeCompare(b.name));
}

export async function scanAgents(): Promise<SkillInfo[]> {
  return scanFileItems(AGENT_KIND);
}

export async function scanCommands(): Promise<SkillInfo[]> {
  return scanFileItems(COMMAND_KIND);
}
