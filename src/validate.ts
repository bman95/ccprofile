// Profile names become filenames under ~/.claude/profiles/, so they must be
// restricted to a safe character set to prevent path traversal and collisions
// with internal dotfiles (.active, .baseline.json).
import { CliError } from "./errors.js";

const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function assertValidProfileName(name: string): void {
  if (!name || !VALID_NAME.test(name)) {
    throw new CliError(
      `Invalid profile name "${name}". Use letters, numbers, dots, dashes, ` +
        `and underscores; it must not start with a dot.`
    );
  }
  if (name.includes("..")) {
    throw new CliError(`Invalid profile name "${name}".`);
  }
}

/** Validate untrusted profile JSON (e.g. from `ccprofile import`). */
export function validateProfileShape(data: unknown): asserts data is import("./types.js").Profile {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new CliError("Invalid profile: expected a JSON object.");
  }
  const p = data as Record<string, unknown>;
  if (typeof p.name !== "string") {
    throw new CliError('Invalid profile: missing string "name" field.');
  }
  assertValidProfileName(p.name);
  if (p.version !== undefined && typeof p.version !== "number") {
    throw new CliError('Invalid profile: "version" must be a number.');
  }
  if (p.description !== undefined && typeof p.description !== "string") {
    throw new CliError('Invalid profile: "description" must be a string.');
  }
  for (const key of ["skills", "agents", "commands"] as const) {
    const v = p[key];
    if (v !== undefined && (!Array.isArray(v) || v.some((s) => typeof s !== "string"))) {
      throw new CliError(`Invalid profile: "${key}" must be an array of strings.`);
    }
    // Item names are joined into filesystem paths by syncItems.
    if (
      Array.isArray(v) &&
      v.some(
        (s: string) =>
          !s || s.includes("/") || s.includes("\\") || s.includes("..") || s.startsWith(".")
      )
    ) {
      throw new CliError(`Invalid profile: "${key}" contains an unsafe item name.`);
    }
  }
  for (const key of ["plugins", "mcpServers"] as const) {
    const v = p[key];
    if (v !== undefined) {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        throw new CliError(`Invalid profile: "${key}" must be an object of booleans.`);
      }
      if (Object.values(v).some((b) => typeof b !== "boolean")) {
        throw new CliError(`Invalid profile: "${key}" values must be booleans.`);
      }
    }
  }
}
