# FABLE5 Next Steps — ccprofile

Plan date: 2026-07-01. Based on `FABLE5-AUDIT.md` (audited at commit `4fdfa16`, v0.3.0, 20/20 tests passing).

**SAFE tag** = safe for an AI agent to implement autonomously tonight: local changes to code, tests, or docs only. NOT SAFE = requires accounts, credentials, publishing, or other external/irreversible actions.

## Quick wins

| # | Step | Priority | SAFE tonight |
|---|------|----------|--------------|
| 1 | Reject unknown flags | P0 | SAFE |
| 2 | Fail loudly on corrupted settings.json | P1 | SAFE |
| 3 | Remove hardcoded personal skill names from `init` suggestions | P2 | SAFE |

### 1. Reject unknown flags (P0, SAFE)

- **Rationale:** `src/cli.ts:27-31` accepts any `--*` token and silently drops unknown ones. `ccprofile use docs --dryrun` (typo for `--dry-run`) performs a **real** activation on a tool that rearranges `~/.claude`. This is the cheapest high-impact fix in the audit.
- **Acceptance criteria:**
  - A whitelist of known flags per command (or globally: `--project`, `--dry-run`, `--json`, `--enable`, `--disable`); any other `--*` token prints an error naming the flag and exits non-zero **before** any mutation.
  - New integration test in `test/cli.test.mjs`: `use <profile> --dryrun` exits non-zero and leaves skills/settings untouched.
  - All existing 20 tests still pass.
- **Effort:** ~1 hour.

### 2. Fail loudly on corrupted settings.json (P1, SAFE)

- **Rationale:** `readJson` (`src/config.ts:9-15`) swallows JSON parse errors, so a hand-corrupted `settings.json` reads as `{}` and gets overwritten on the next apply, silently dropping unrelated user settings.
- **Acceptance criteria:**
  - Distinguish "file missing" (return `null`, fine) from "file exists but unparseable" (throw / abort the command with a clear message pointing at the file and the `.bak` backups).
  - New test: write invalid JSON to the temp-HOME `settings.json`, run `use`, assert non-zero exit and that the file content is unchanged.
  - Existing tests pass.
- **Effort:** ~1 hour.

### 3. Genericize `init` suggested profiles (P2, SAFE)

- **Rationale:** `src/init.ts:91-102` hardcodes the author's personal skill names (`travel-router`, `eu-directive-transposition-tracker`, `fix-codex-comments`) in a package presented as general-purpose. Harmless but unprofessional.
- **Acceptance criteria:** Suggestions derive from data actually found on the user's machine (or generic examples); no personal skill names remain anywhere in `src/`; `npm test` passes.
- **Effort:** ~30 min.

## Main steps

### 4. Fix the reset guarantee for mixed global/`--project` usage (P0, SAFE)

- **Rationale:** The audit's top finding. The baseline is a single snapshot tied to one `settingsPath` (`src/apply.ts:29-31`, `src/baseline.ts:47-51`). Sequence `use a --project` → `use b` (global) → `reset` never restores the global file's plugin/MCP changes, silently — breaking the README's "fully reversible" promise.
- **Suggested approach (pick one, state the choice in the commit):**
  - **Extend:** make the baseline hold a per-settings-file map of captured settings slices; `ensureBaseline` adds an entry for any not-yet-captured `settingsPath`; `reset` restores every captured file. Preserve legacy single-file baseline migration (there is precedent for this in `resetProfile`).
  - **Or restrict:** if a baseline exists for a different `settingsPath`, refuse the activation with a clear error ("reset first or stay on the same target"). Smaller, still honest.
- **Acceptance criteria:**
  - New integration test reproducing the audit scenario (project activation, then global activation, then `reset`), asserting the global settings file is byte-identical (for the managed keys) to its pre-activation state — or, with the restrict option, asserting the second activation is refused with no mutation.
  - Legacy baselines (v0.2 shape and v0.3 single-`settingsPath` shape) still reset correctly (covered by existing baseline round-trip tests plus one migration test).
  - README reversibility wording (lines ~174-179, 200) updated to match the actual guarantee.
- **Effort:** 3-5 hours (extend) / 1-2 hours (restrict).

### 5. Small consistency fixes: `auto` project support + dry-run reset wording (P2, SAFE)

- **Rationale:** `cmdAuto` (`src/cli.ts:485-510`) never passes `projectDir`, so auto-switching always edits global settings even in a directory with project settings; and `resetProfile` pushes "Restored original environment..." into `changes` even on `--dry-run` (`src/apply.ts:87,94`), misleading output.
- **Acceptance criteria:** `reset --dry-run` output uses "would" phrasing and makes no writes (test asserts baseline file still present); `auto` behavior with project settings is either supported or explicitly documented as global-only in `--help` and README. Tests pass.
- **Effort:** 1-2 hours.

### 6. Document fragility caveats + add CHANGELOG (P2, SAFE)

- **Rationale:** The mechanism depends on undocumented Claude Code conventions (`skills-disabled` sibling dirs, `enabledMcpjsonServers` keys) and can break silently on a Claude Code update; the README does not say so. Three feature releases exist with no CHANGELOG.
- **Acceptance criteria:** README gains a short "Caveats / compatibility" section stating the coupling and the token-estimate limitations (single-line frontmatter only; plugin/MCP context uncounted); `CHANGELOG.md` created covering 0.1.0-0.3.0 from git history. No code changes.
- **Effort:** ~1 hour.

### 7. Release v0.3.1 to npm (P2, NOT SAFE)

- **Rationale:** Once steps 1-4 land, the fixes only help others if published. The audit could not verify whether the package is currently published; that check and any `npm publish` need Bryan's npm account.
- **Acceptance criteria:** version bumped, `prepublishOnly` build passes, package published (or the decision made not to publish), git tag pushed.
- **Effort:** ~30 min (human).

## Deliberately deferred

- **Concurrency/locking for the multi-step item sync** (audit Risk 2): real but low-probability for a single-user tool; the "exists in both" warnings already surface it. Revisit only if it bites in practice or outside users appear.
- **Better token estimation** (multi-line frontmatter, plugin/MCP context): documented as heuristic in step 6; not worth engineering effort until there is evidence users rely on the numbers.
- **Major new features:** per the audit verdict, hold off until there is evidence of outside users; Claude Code's native context management may obsolete parts of this tool.
