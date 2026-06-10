import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { paths } from "./paths.js";
import { readJson, writeJsonSafe } from "./config.js";

/** Directory → profile bindings, stored in ~/.claude/profiles/.bindings.json */
export type Bindings = Record<string, string>;

export async function getBindings(): Promise<Bindings> {
  return (await readJson<Bindings>(paths.bindingsFile)) ?? {};
}

export async function setBinding(dir: string, profile: string): Promise<string> {
  const abs = resolve(dir);
  const bindings = await getBindings();
  bindings[abs] = profile;
  await writeJsonSafe(paths.bindingsFile, bindings);
  return abs;
}

export async function removeBinding(dir: string): Promise<boolean> {
  const abs = resolve(dir);
  const bindings = await getBindings();
  if (!(abs in bindings)) return false;
  delete bindings[abs];
  if (Object.keys(bindings).length === 0) {
    if (existsSync(paths.bindingsFile)) await rm(paths.bindingsFile);
  } else {
    await writeJsonSafe(paths.bindingsFile, bindings);
  }
  return true;
}

/**
 * Find the binding that applies to `fromDir` by walking up the directory tree,
 * so a binding on a repo root covers every subdirectory.
 */
export function findBinding(
  bindings: Bindings,
  fromDir: string
): { dir: string; profile: string } | null {
  let cur = resolve(fromDir);
  for (;;) {
    if (cur in bindings) return { dir: cur, profile: bindings[cur] };
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}
