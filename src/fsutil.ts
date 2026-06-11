import { rename, cp, rm } from "node:fs/promises";

/**
 * Move a directory or file, falling back to copy+remove when source and
 * destination live on different filesystems (rename throws EXDEV in that
 * case). This can happen when ~/.claude lives on a different mount than a
 * temp/overlay dir.
 */
export async function moveDir(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await cp(from, to, { recursive: true, force: true });
      await rm(from, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}
