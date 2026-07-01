# FABLE5 Implementation Log — ccprofile

Date: 2026-07-01. Implemented against v0.3.0 (branch `master`).

## Starting state

- `git status --short` before work: working tree contained two pre-existing
  untracked files (`FABLE5-AUDIT.md`, `FABLE5-NEXT-STEPS.md`). These were left
  untouched.
- Baseline: `npm test` → 20/20 passing before any change.

All six steps were implemented. Final state: `npm run build` clean (tsc strict),
`npm test` → 24/24 passing (20 original + 4 new).

---

## Step 1 [P0] — Reject unknown flags

**What changed:** Added a `KNOWN_FLAGS` whitelist (`--project`, `--dry-run`,
`--json`, `--force`, `--enable`, `--disable`, `--help`, `--version`). At the top
of `main()`, before any command dispatch or mutation, any `--*` token not in the
whitelist prints `Unknown flag: <flag>` and exits non-zero. A typo like
`use docs --dryrun` now aborts instead of performing a real activation.

**Files touched:** `src/cli.ts`.

**Verification:**
- New test `unknown flags are rejected before any mutation` asserts
  `use docs --dryrun` exits 1, prints the error, moves no skills, and leaves no
  active profile.
- Manual: `node dist/cli.js use docs --dryrun` → `Unknown flag: --dryrun`,
  exit 1. `node dist/cli.js --help` still works (exit 0).
- `npm test` → 24/24 pass.

---

## Step 2 [P0] — Fix reset guarantee for mixed --project/global activations

**Design choice:** the "restrict" option from the plan (smaller, safe, honest).
The baseline holds a single settings file. In `applyProfile`, before the first
mutation, if a baseline already exists and its captured `settingsPath` (defaulting
to the global `settings.json` for legacy baselines) differs from the settings
target of the current activation, the activation is refused with a clear error
telling the user to `reset` first. No mutation occurs on refusal (the throw
propagates to `main().catch`, which exits 1). This closes the gap where
`use a --project` → `use b` (global) → `reset` left the global file's plugin/MCP
changes unrestored.

**Files touched:** `src/apply.ts` (guard in `applyProfile`). README wording
updated (see below).

**Verification:**
- New test `mixing --project and global activations is refused, keeping reset
  reversible`: activates a profile against a project settings file, then attempts
  a global activation — asserts exit 1, error mentions `reset`, the global
  `settings.json` is byte-identical (no mutation), and a subsequent `reset` fully
  restores the project file.
- Legacy baseline shapes still reset correctly: existing tests `reset restores
  skills AND plugin/mcp state from baseline`, `switching profiles does not corrupt
  the baseline`, `profiles toggle agents and commands, and reset restores them`,
  and `use --project applies and reset restores project settings` all still pass.
- README reversibility wording updated in "How it works" and "Important notes".

---

## Step 3 [P1] — Fail loudly on corrupted settings.json

**What changed:** `readJson` now distinguishes a missing file (ENOENT → returns
`null`, the normal "nothing configured yet" state) from a file that exists but
is unparseable (throws `Cannot parse <path>: ... invalid JSON ...`, pointing at
the `.bak` backups). Previously all errors were swallowed and returned `null`,
so a hand-corrupted `settings.json` was treated as `{}` and could be overwritten,
dropping unrelated user settings. The parse failure surfaces during
`ensureBaseline`/`captureBaseline`'s read of settings, before any write, so the
command aborts and the file is left untouched.

**Files touched:** `src/config.ts`.

**Verification:**
- New test `corrupted settings.json aborts the command without overwriting it`:
  writes invalid JSON to the temp-HOME `settings.json`, runs `use docs`, asserts
  exit 1, error matches `/invalid JSON/i`, and the file content is byte-identical
  to the corrupt input.
- `npm test` → 24/24 pass (no regression from the broadened readJson behavior;
  `computeStats` does not read settings.json, so `current`/`stats` still work).

---

## Step 4 [P2] — Remove hardcoded personal skill names from init suggestions

**What changed:** Replaced the four hardcoded suggestion blocks (which named the
author's personal skills `travel-router`, `eu-directive-transposition-tracker`,
`fix-codex-comments`, plus `gh-issue`, `issue-workflow`, `doc-coauthoring`) with
a data-driven loop over three generic capability categories (`docs`, `browser`,
`github`), each matching the skills actually installed on the machine by generic
keyword substrings. No personal skill names remain in `src/`.

**Files touched:** `src/init.ts`.

**Verification:**
- `grep -rniE "travel-router|eu-directive|fix-codex-comments|gh-issue|issue-workflow|doc-coauthoring" src/`
  → no matches.
- `npm run build` clean; `npm test` → 24/24 pass (there is no `init` test, per
  the audit; the change is generic and does not affect other commands).

---

## Step 5 [P2] — Consistency fixes: dry-run reset wording + auto project handling

**Dry-run reset wording:** `resetProfile` summary lines now use "would" phrasing
on dry-run ("Would restore original environment ..." / "Would clear profile ...").
Writes were already correctly gated behind `!opts.dryRun`, so the baseline file
is untouched by `reset --dry-run`.

**auto project handling:** Chose the "document global-only" option. `auto` was
left targeting the global settings file (its existing behavior), and this is now
documented in `--help` (the `auto` command line and the `--project` option line)
and in the README's auto-switching and project-level sections.

**Files touched:** `src/apply.ts` (wording), `src/cli.ts` (HELP text), `README.md`.

**Verification:**
- New test `reset --dry-run uses 'would' phrasing and writes nothing`: after a
  real `use`, `reset --dry-run` output matches `/[Ww]ould/`, does not print the
  "Restart Claude Code" line, leaves the disabled skill still disabled, leaves
  the `.baseline.json` file present, and keeps `docs` active.
- `npm test` → 24/24 pass.

---

## Step 6 [P2] — Document coupling caveats + add CHANGELOG

**What changed (docs only, no code):**
- README gained a "Caveats / compatibility" section covering: coupling to
  undocumented Claude Code conventions (`*-disabled` sibling dirs,
  `enabledPlugins`/`enabledMcpjsonServers`/`disabledMcpjsonServers` keys) that
  can break silently on a Claude Code update; token-estimate limits (single-line
  frontmatter only, plugin/MCP context uncounted); next-session apply timing;
  and the absence of concurrency locking.
- Added `CHANGELOG.md` covering 0.1.0 → 0.3.0 reconstructed from the six-commit
  git history (no tags exist), plus an `[Unreleased]` section recording the
  fixes made in this session. Keep a Changelog format.

**Files touched:** `README.md`, `CHANGELOG.md` (new).

**Note:** `CHANGELOG.md` was intentionally not added to `package.json`'s `files`
array, to honor the step's "no code changes" constraint; adding it to the
published package is a reasonable optional follow-up.

**Verification:** No code changes; `npm test` → 24/24 pass (unchanged).

---

## Skipped steps

None. All six overnight-safe steps were implemented. (Plan steps 7 "Release to
npm" and the deferred concurrency/token-estimation items were out of scope for
this task and remain not done, as intended.)

## Files changed (summary)

- `src/cli.ts` — unknown-flag rejection; help text for auto/`--project`.
- `src/apply.ts` — mixed-target activation guard; dry-run reset wording.
- `src/config.ts` — readJson distinguishes missing vs. corrupt files.
- `src/init.ts` — data-driven, generic profile suggestions.
- `test/cli.test.mjs` — 4 new integration tests (24 total).
- `README.md` — reversibility wording, auto global-only note, Caveats section.
- `CHANGELOG.md` — new.

Pre-existing untracked files (`FABLE5-AUDIT.md`, `FABLE5-NEXT-STEPS.md`) were
left untouched. No commits were made.

---

## Fable 5 Review

Independent reviewer, 2026-07-02. Verified against the actual working-tree diff
(no commits present; all changes unstaged/untracked as self-reported).

**Verdict: PASS.** All six steps are present in the diff, match their acceptance
criteria, and the verification commands reproduce cleanly.

- Build: `npm run build` (tsc strict) exits 0, clean. Re-run confirmed.
- Tests: `npm test` → 24/24 passing (20 pre-existing + 4 new). Re-run confirmed.
- No secrets/credentials introduced (diff scanned). No user data deleted, no
  forbidden git commands, no network access. `git status` matches the self-
  report exactly (6 modified files, CHANGELOG.md new, two pre-existing FABLE5
  audit/next-step files untouched).

Per-step verification:

- **[P0] Unknown flags** — `KNOWN_FLAGS` set + guard at top of `main()` in
  `src/cli.ts` runs before dispatch and calls `exit(1)`. Cross-checked that the
  whitelist covers every `--flag` actually referenced in `src/` (grep: only
  `--dryrun`, the typo example in a comment, is absent — correct). Manual smoke:
  `node dist/cli.js use docs --dryrun` → `Unknown flag: --dryrun`, exit 1;
  `--help` exit 0; `--version` → 0.3.0. New test passes. Verified.
- **[P0] Mixed project/global reset guarantee** — `applyProfile` throws before
  any mutation when an existing baseline's `settingsPath` differs from the
  current target (`getBaseline`/`paths` already imported; throw propagates to
  `main().catch` → exit 1). Legacy baselines default to global `settingsJson`.
  Closes the documented gap; same-target profile switching still works
  (existing test green). New test passes. Verified.
- **[P1] Corrupted settings.json** — `readJson` in `src/config.ts` returns
  `null` only on ENOENT and throws `Cannot parse ...: invalid JSON` otherwise.
  Confirmed the throw surfaces via `captureBaseline`'s read (inside
  `ensureBaseline`) before any file move, so the corrupt file is left byte-
  identical. New test passes. Verified.
- **[P2] Remove personal skill names** — `src/init.ts` replaced with a
  data-driven loop over generic `docs`/`browser`/`github` keyword categories;
  the `travel` block is gone. `grep -rniE` for the six personal names in `src/`
  → no matches. Build clean. Verified. (Minor, non-blocking: the `docs`
  keyword `"doc"` and `github` keyword `"issue"` are broad substrings, but this
  is an intentional generic-matching tradeoff, not a defect.)
- **[P2] Dry-run wording + auto global-only** — `resetProfile` emits "Would…"
  on dry-run (writes already gated behind `!dryRun`); HELP text and README
  document `auto` as global-only and `--project` as `use`-only. New test
  asserts `/Would/`, no `Restart Claude Code` line, baseline + active profile
  intact. Passes. Verified.
- **[P2] Caveats + CHANGELOG** — README "Caveats / compatibility" section and a
  Keep-a-Changelog `CHANGELOG.md` (Unreleased + reconstructed 0.1.0–0.3.0)
  added; docs-only, no code touched. `CHANGELOG.md` honestly noted as not added
  to `package.json` `files` (optional follow-up). Verified.

No regressions found. Self-report is accurate; nothing was left unverified.
