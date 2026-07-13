# FABLE5 Audit — ccprofile

Audit date: 2026-07-01. Audited at commit `4fdfa16` (2026-06-11, master, clean working tree, pushed to `github.com/bman95/ccprofile`).

## Overview

`ccprofile` (v0.3.0) is a TypeScript/Node CLI that manages "profiles" for Claude Code: named groups of skills, subagents, slash commands, plugins, and MCP servers that can be toggled together to shrink the system prompt. It works by moving skill/agent/command files between `~/.claude/<kind>/` and `~/.claude/<kind>-disabled/`, and by editing `enabledPlugins` / `enabledMcpjsonServers` / `disabledMcpjsonServers` in `settings.json`. Extras: per-directory auto-switching (`bind`/`auto`), token-cost stats, baseline snapshot + reversible `reset`, export/import, and a bundled non-auto-invocable companion skill (`skill/SKILL.md`).

## Current State

- Six commits, all feature-complete releases culminating in a merged PR ("project-completion-optimization"). Last activity 2026-06-11 (~3 weeks ago).
- ~2,000 lines total: 14 small source modules in `src/`, one 330-line integration test file, an 8.8 KB README.
- Builds cleanly (`tsc`, strict mode) and all 20 tests pass (`npm test`, verified during this audit).
- Single runtime dependency (`write-file-atomic`); packaged for npm (`bin`, `files`, `prepublishOnly`). Whether it is actually published was not verified.

## Architecture & Code Quality

Clean layering: `cli.ts` (argument parsing + command dispatch) → domain modules (`profiles.ts`, `apply.ts`, `items.ts`, `baseline.ts`, `bindings.ts`, `stats.ts`) → utilities (`config.ts`, `fsutil.ts`, `paths.ts`, `validate.ts`). The `KindSpec` abstraction in `src/items.ts:27-70` unifies skills/agents/commands behind one sync algorithm — a genuinely good consolidation. Notable strengths:

- Path-traversal defenses on both profile names (`src/validate.ts:4-16`) and imported item names (`src/validate.ts:36-45`), with tests covering both.
- Atomic writes + timestamped backups with pruning (`src/config.ts:17-52`).
- EXDEV-aware move fallback (`src/fsutil.ts:9-20`) and symlink/dangling-symlink handling (`src/items.ts:79-87`).
- Sensible "empty list = leave kind untouched" semantics, documented and tested.

Concrete issues:

- `src/cli.ts:27-31` — flag parsing accepts any `--*` token and silently ignores unknown flags. A typo like `ccprofile use docs --dryrun` performs a **real** activation instead of a dry run. For a tool that moves directories around in `~/.claude`, unknown flags should be an error.
- `src/init.ts:91-102` — the "suggested profiles" heuristic hardcodes the author's personal skill names (`travel-router`, `eu-directive-transposition-tracker`, `fix-codex-comments`) into what is presented as a general-purpose npm package. Harmless but unprofessional for a published tool; suggestions should be generic or data-driven.
- `src/cli.ts:485-510` — `cmdAuto` never passes `projectDir`, so `auto` always targets global settings even when the bound directory has project-level settings; there is no `--project` support for `auto`. Minor inconsistency with `use`.
- `src/apply.ts:87` / `src/apply.ts:94` — the summary line ("Restored original environment ...") is pushed into `changes` even on `--dry-run`, slightly misleading output ("would be" phrasing is absent for reset).
- `src/config.ts:29` — every `saveProfile` also produces `.bak` files next to profile JSONs in `~/.claude/profiles/` (correctly excluded from listings, but the directory accumulates up to 6 backup files per profile).

## Bugs & Risks

1. **Mixed global/project usage corrupts the restore guarantee** (design gap, the most significant issue). The baseline is a single file tied to one `settingsPath` (`src/apply.ts:26-31`, `src/baseline.ts:47-51`, `src/types.ts:38`). Scenario: `ccprofile use a --project` (baseline captures the *project* settings file), then `ccprofile use b` (modifies *global* `settings.json`; `ensureBaseline` is a no-op because a baseline already exists), then `ccprofile reset` — plugin/MCP changes made to the global file by profile `b` are never restored, silently. The README promises "fully reversible"; that promise only holds when all activations target the same settings file.
2. **No concurrency protection.** Two concurrent `ccprofile` invocations (e.g. a `SessionStart` hook racing a manual command, as suggested in README lines 133-151) can interleave `listEntries` → `moveDir` and produce a mixed active/disabled state. Writes are atomic per file, but the multi-step sync in `src/items.ts:105-164` is not transactional. Warnings for "exists in both" (items.ts:132-134, 148-150) mitigate detection, not occurrence.
3. **Token estimates are heuristic and partially wrong by design** — `src/skills.ts:34-52` only parses single-line frontmatter `key: value` pairs, so multi-line/folded descriptions (common in real skills) are undercounted; plugin- and MCP-provided context is not counted at all. Acknowledged in comments/README, but users may over-trust the numbers.
4. `readJson` swallows all errors including malformed JSON (`src/config.ts:9-15`), so a hand-corrupted `settings.json` is treated as `{}` and would be **overwritten** (minus backup) on the next apply, silently dropping unrelated user settings. A parse-failure guard before writing would be safer.
5. Fragile coupling to Claude Code internals: the entire mechanism depends on undocumented conventions (`skills-disabled` sibling dirs, `enabledMcpjsonServers` keys). A Claude Code update can quietly break it. Inherent to the product idea, worth stating in README as a caveat (it currently is not).

No security issues found beyond the mitigated path-traversal vectors; no secrets, tokens, or credentials anywhere in the tracked tree.

## Tests & Docs

- **Tests**: `test/cli.test.mjs` — 20 black-box integration tests running the built CLI against a temp `$HOME`. Coverage of the happy paths and key invariants is good: keep-list semantics, baseline round-trip, profile switching not corrupting the baseline, dry-run, bindings, rename/delete side effects, import validation, `--project`. Gaps: no test for the mixed global/project reset scenario (Risk 1), no unknown-flag behavior test, no concurrency test, nothing for `init` (it writes into the real skills dir and exercises the hardcoded suggestions). Tests are integration-only; fine at this size.
- **Docs**: `README.md` is genuinely good — problem statement, honest explanation of the token-estimate heuristic, how-it-works internals, hook caveat ("takes effect on the next session"). The reversibility claim (lines 174-179, 200) overstates the guarantee per Risk 1. No CHANGELOG despite three feature releases; no CI workflow.

## Hygiene

- Clean: `.gitignore` covers `node_modules/`, `dist/`, `*.tgz`; only sources, tests, LICENSE, README are tracked; working tree has no untracked cruft.
- `dist/` exists locally (stale builds are possible since `npm test` rebuilds) — fine, ignored.
- No dead files, screenshots, or stored credentials. `package-lock.json` is committed (correct for an app-with-bin).
- Minor: user's real name in `package.json` author field is intentional; repository URL matches the actual remote.

## Verdict

**Maturity: usable.** This is one of the more polished small projects a solo dev could ship: strict TypeScript, a real integration test suite that passes, thoughtful edge-case handling (atomic writes, EXDEV, symlinks, path traversal, legacy baseline migration), and an honest README. It does what it claims for the common workflow. The honest caveats: the reversibility guarantee has a real hole when mixing `--project` and global activations (Risk 1); silent acceptance of misspelled flags is dangerous for a tool that rearranges `~/.claude`; and the whole approach is coupled to undocumented Claude Code conventions, so it will need maintenance whenever Claude Code changes its loading behavior. Also, note the strategic overlap: Claude Code itself has been steadily gaining native context-management features, so the project's long-term relevance depends on upstream not obsoleting it. Worth keeping alive and fixing Risk 1 + flag validation; not worth major new features until there's evidence of outside users.
