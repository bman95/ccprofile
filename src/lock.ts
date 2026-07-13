import { open, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./paths.js";
import { CliError } from "./errors.js";

export const LOCK_FILE = join(paths.profilesDir, ".lock");

/** A lock older than this is considered stale even if its PID looks alive (PID reuse). */
const STALE_MS = 10 * 60 * 1000;

interface LockInfo {
  pid: number;
  at: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function lockIsStale(info: LockInfo | null): boolean {
  if (!info || typeof info.pid !== "number") return true;
  const age = Date.now() - Date.parse(info.at ?? "");
  if (Number.isFinite(age) && age > STALE_MS) return true;
  return !pidAlive(info.pid);
}

export async function readLock(): Promise<LockInfo | null> {
  try {
    return JSON.parse(await readFile(LOCK_FILE, "utf-8")) as LockInfo;
  } catch {
    return null;
  }
}

async function acquireLock(): Promise<void> {
  await mkdir(paths.profilesDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(LOCK_FILE, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
        "utf-8"
      );
      await handle.close();
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const info = await readLock();
      if (lockIsStale(info)) {
        // Dead or ancient holder: reclaim and retry once.
        await unlink(LOCK_FILE).catch(() => {});
        continue;
      }
      throw new CliError(
        `Another ccprofile process (pid ${info!.pid}) appears to be mid-activation. ` +
          `Concurrent runs can interleave file moves, so this one is refused. ` +
          `If that process is gone, delete ${LOCK_FILE} and retry.`
      );
    }
  }
  throw new CliError(`Could not acquire ${LOCK_FILE}; delete it manually if no ccprofile is running.`);
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_FILE).catch(() => {});
}

/**
 * Run a mutation under the activation lock. The multi-step item sync is not
 * transactional, so two concurrent activations (e.g. a SessionStart hook
 * racing a manual command) must be serialized rather than interleaved.
 */
export async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLock();
  try {
    return await fn();
  } finally {
    await releaseLock();
  }
}
