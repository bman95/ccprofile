# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions before 0.3.1 were not tagged in git; the entries below are
reconstructed from the commit history.

## [Unreleased]

### Added

- Reject unrecognized `--*` flags up front instead of silently ignoring them,
  so a typo such as `use <profile> --dryrun` no longer performs a real
  activation.
- "Caveats / compatibility" section in the README documenting the coupling to
  undocumented Claude Code conventions and the limits of the token estimates.
- This changelog.

### Changed

- `reset --dry-run` now uses "would" phrasing in its summary and is documented
  as writing nothing (the baseline file is left untouched).
- `init` profile suggestions are now derived from the skills actually installed
  (grouped by generic capability keywords) rather than a hardcoded list of
  personal skill names.
- Documented that `auto` always targets the global settings file and that
  `--project` is supported only by `use`.

### Fixed

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
