# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions before 0.4.0 were not tagged in git; the entries below are
reconstructed from the commit history.

## [0.4.0] - 2026-07-13

### Changed

- **Activation is now declarative.** The desired environment is computed as
  the baseline overlaid with the profile, so switching from profile A to
  profile B reverts A's plugin/MCP toggles instead of accumulating them, and
  plugin + MCP changes land in a single settings write (one backup per
  activation instead of two). Keys ccprofile never touched keep their current
  value.
- **`reset` only touches what the baseline recorded.** Skills installed or
  plugins toggled *while* a profile was active are left alone instead of being
  silently disabled or reverted. The baseline now also records disabled items
  so profile-enabled items return to disabled on reset.
- **Profile schema v2.** An empty `skills`/`agents`/`commands` list now means
  "disable everything of this kind (except protected items)"; an absent key
  still means "leave untouched". Legacy profiles (no `version` field) treated
  `[]` as untouched and are normalized on load, so their behavior is unchanged.
  `snapshot` now records empty kinds explicitly so the exact state round-trips.
- `auto` always reconciles instead of trusting the active-profile marker, so
  drift (manual file moves, profile edits after activation) is repaired.
- Flags are validated per command: a recognized flag on the wrong command
  (e.g. `list --force`) is rejected instead of silently ignored.
- `init` no longer overwrites an existing companion skill the user may have
  customized.
- `init` profile suggestions are now derived from the skills actually installed
  (grouped by generic capability keywords) rather than a hardcoded list of
  personal skill names.
- Frontmatter parsing understands YAML block scalars (`description: >`), so
  multi-line descriptions are counted in token estimates instead of dropped.
- Unexpected internal errors print a full stack trace; expected user-facing
  errors still print a clean one-line message.
- `reset --dry-run` uses "would" phrasing and is documented as writing nothing
  (the baseline file is left untouched).
- Documented that `auto` always targets the global settings file and that
  `--project` is supported only by `use`.

### Added

- **Concurrency locking.** Activations are serialized through
  `~/.claude/profiles/.lock`; a second concurrent activation is refused with a
  clear message and stale locks from crashed runs are reclaimed automatically.
- **`ccprofile doctor`**: health checks for the directories and settings files
  ccprofile depends on, active/disabled collisions, baseline/marker
  consistency, dangling bindings, missing profile items, the companion skill,
  and lock state. Exits non-zero on failures; supports `--json`.
- `--json` output for the mutating commands (`create`, `snapshot`, `add`,
  `remove`, `rename`, `delete`, `bind`, `unbind`, `import`).
- `add` warns immediately when the named skill/agent/command is not installed
  (the entry is kept, since profiles may be shared across machines).
- CI workflow running the test suite on Linux, macOS, and Windows across
  Node 18/20/22.
- Reject unrecognized `--*` flags up front instead of silently ignoring them,
  so a typo such as `use <profile> --dryrun` no longer performs a real
  activation.
- "Caveats / compatibility" section in the README documenting the coupling to
  undocumented Claude Code conventions and the limits of the token estimates.
- This changelog.

### Fixed

- Control characters in imported profile descriptions (and other untrusted
  strings) are stripped from terminal output, closing an escape-sequence
  injection vector via shared profiles.
- Backup pruning used `/`-splitting to find the settings file name and never
  matched on Windows, so backups accumulated forever there.
- A permission error reading the active-profile marker no longer masquerades
  as "no active profile".
- Imported profiles are stripped to their known fields instead of persisting
  arbitrary extra JSON.
- Refuse to activate a profile against a different settings target (global vs.
  `--project`) while another profile is still active, closing a gap where
  `reset` could silently fail to restore one of the two files.
- A corrupted (unparseable) `settings.json` now aborts the command with a clear
  message instead of being treated as `{}` and overwritten. Missing files are
  still handled as an empty configuration.

## [0.3.0] - 2026-06-11

### Added

- Subagents and slash commands can now be toggled per profile, using the same
  keep-list semantics as skills (`~/.claude/agents[-disabled]/` and
  `~/.claude/commands[-disabled]/`).
- Per-directory auto-switching: `bind`, `unbind`, `bindings`, and `auto`
  activate the profile bound to the current directory tree.
- `export` and `import` profiles as JSON (file or stdin), with shape and
  path-traversal validation and a `--force` overwrite flag.

## [0.2.0] - 2026-06-10

### Added

- `stats` command estimating the idle system-prompt token cost of each skill,
  agent, and command, and the savings per profile.
- Reversible `reset`: the first activation from a clean state records a baseline
  snapshot of skills, plugins, and MCP servers that `reset` restores.
- `snapshot` command to capture the current environment as a new profile.

### Changed

- Hardening: atomic settings writes with timestamped backups, EXDEV-aware file
  moves, and symlink handling.

## [0.1.0] - 2026-04-01

### Added

- Initial release: create, list, show, rename, delete, and `use` profiles that
  group skills, plugins, and MCP servers to shrink the Claude Code system
  prompt.
- `init` command that verifies the Claude Code install, creates the profiles
  and `skills-disabled` directories, installs the `/profile-edit` companion
  skill, and scans the current environment.
