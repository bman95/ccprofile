import { readFile, writeFile as fsWriteFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import writeFileAtomic from "write-file-atomic";

export async function readJson<T = Record<string, unknown>>(
  filePath: string
): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonSafe(
  filePath: string,
  data: Record<string, unknown>
): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  // Backup existing file before overwriting
  if (existsSync(filePath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${filePath}.${timestamp}.bak`;
    await copyFile(filePath, backupPath);

    // Keep only the 5 most recent backups
    await pruneBackups(filePath);
  }

  const json = JSON.stringify(data, null, 2) + "\n";
  await writeFileAtomic(filePath, json, { encoding: "utf-8" });
}

async function pruneBackups(filePath: string): Promise<void> {
  const { readdir, unlink } = await import("node:fs/promises");
  const dir = dirname(filePath);
  const base = filePath.split("/").pop()!;
  const pattern = new RegExp(`^${escapeRegex(base)}\\.\\d{4}-.*\\.bak$`);

  const entries = await readdir(dir);
  const backups = entries.filter((e) => pattern.test(e)).sort().reverse();

  for (const old of backups.slice(5)) {
    await unlink(`${dir}/${old}`).catch(() => {});
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
