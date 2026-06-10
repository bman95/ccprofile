// Profile names become filenames under ~/.claude/profiles/, so they must be
// restricted to a safe character set to prevent path traversal and collisions
// with internal dotfiles (.active, .baseline.json).
const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function assertValidProfileName(name: string): void {
  if (!name || !VALID_NAME.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use letters, numbers, dots, dashes, ` +
        `and underscores; it must not start with a dot.`
    );
  }
  if (name.includes("..")) {
    throw new Error(`Invalid profile name "${name}".`);
  }
}
