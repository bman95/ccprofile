# ccprofile

Profile manager for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — toggle groups of skills, subagents, slash commands, plugins, and MCP servers to optimize your context window.

## The problem

Claude Code loads **all** registered skills, agents, slash commands, plugins, and MCP server definitions into the system prompt on every turn. With 30+ skills installed, this wastes thousands of tokens even when most capabilities aren't needed for the current task.

## The solution

`ccprofile` lets you define named profiles that group skills, agents, commands, plugins, and MCP servers. Switch between them with a single command to keep only what you need in your context window — or bind profiles to directories and let `ccprofile auto` switch for you.

## Install

```bash
npm install -g ccprofile
ccprofile init
```

The `init` command:
- Verifies Claude Code is installed
- Creates `~/.claude/profiles/` and `~/.claude/skills-disabled/` directories
- Installs a companion skill (`/profile-edit`) for AI-assisted profile editing
- Scans your current skills and plugins and suggests profile groupings

## Quick start

```bash
# See how many tokens each installed skill costs you
ccprofile stats

# Capture your current setup so you can always get back to it
ccprofile snapshot baseline

# Create a profile for document work
ccprofile create docs "Document processing"

# Add skills that should stay active when this profile is used
ccprofile add docs skill pdf
ccprofile add docs skill docx
ccprofile add docs skill xlsx

# Agents and slash commands work the same way
ccprofile add docs agent doc-reviewer
ccprofile add docs command summarize

# Disable plugins you don't need for doc work
ccprofile add docs plugin "frontend-design@claude-plugins-official" --disable

# Preview exactly what would change — no writes
ccprofile use docs --dry-run

# Activate the profile (moves unused skills to ~/.claude/skills-disabled/)
ccprofile use docs

# Check what's active and how many tokens you're saving
ccprofile current

# Go back to your original state (restores skills, plugins, AND MCP servers)
ccprofile reset
```

## Commands

| Command | Description |
|---------|-------------|
| `ccprofile init` | Set up ccprofile (dirs, companion skill, environment scan) |
| `ccprofile use <name>` | Activate a profile |
| `ccprofile current` | Show active profile and current token savings |
| `ccprofile list` | List all profiles |
| `ccprofile show <name>` | Show profile details and estimated savings |
| `ccprofile create <name> [desc]` | Create a new profile |
| `ccprofile snapshot <name> [desc]` | Capture the current environment as a new profile |
| `ccprofile rename <from> <to>` | Rename a profile |
| `ccprofile delete <name>` | Delete a profile |
| `ccprofile reset` | Restore the original environment, clear active profile |
| `ccprofile stats` | Show per-item token cost and per-profile savings |
| `ccprofile doctor` | Check the environment and ccprofile state for problems |
| `ccprofile add <profile> plugin <name> [--enable\|--disable]` | Add plugin toggle |
| `ccprofile add <profile> <skill\|agent\|command> <name>` | Add skill/agent/command to profile |
| `ccprofile add <profile> mcp <name> [--enable\|--disable]` | Add MCP server toggle |
| `ccprofile remove <profile> <plugin\|skill\|agent\|command\|mcp> <name>` | Remove item from profile |
| `ccprofile bind <profile> [dir]` | Bind a directory (default: cwd) to a profile |
| `ccprofile unbind [dir]` | Remove a directory binding |
| `ccprofile bindings` | List directory bindings |
| `ccprofile auto` | Activate the profile bound to the current directory |
| `ccprofile export <name> [file]` | Export a profile as JSON (stdout if no file) |
| `ccprofile import <file\|->` | Import a profile from a JSON file or stdin (`--force` to overwrite) |

All read commands accept `--json` for scripting. `use` and `reset` accept `--dry-run`
to preview changes without writing anything.

## Measuring token savings

The whole point of ccprofile is to shrink the system prompt, so it can show you
exactly what that costs. Claude Code loads each skill/agent/command's metadata
(name + description) into the system prompt on every turn until it is actually
invoked. `ccprofile stats` estimates that recurring idle cost per item and how
much each profile saves:

```
$ ccprofile stats
Idle token cost per item (loaded into the system prompt every turn):

  [on]    180 tok  skill    playwright-cli
  [on]     95 tok  skill    pdf
  [on]     60 tok  agent    code-reviewer
  [on]     22 tok  command  deploy
  [off]     0 tok  skill    ccprofile   # non-auto-invocable → ~0 idle cost

  Total if all enabled: ~620 tokens
  Currently active:     ~275 tokens

Estimated savings per profile (vs. everything enabled):

  docs             active ~190 tok, saves ~430 tok
```

Estimates use a ~4 chars/token heuristic over each item's frontmatter, and
items marked `disable-model-invocation: true` are counted as ~0 since they are
not auto-loaded.

## Auto-switching per project

Bind a profile to a directory and ccprofile will pick it up from anywhere
inside that tree:

```bash
ccprofile bind docs ~/work/docs-repo
cd ~/work/docs-repo/src
ccprofile auto          # activates "docs" (re-syncs if drifted, no-op if in sync)
```

`auto` applies plugin/MCP changes to the **global** `~/.claude/settings.json`
only; it has no `--project` mode. If you need project-level settings changes,
activate explicitly with `ccprofile use <profile> --project`.

To make this automatic, run it before each session — e.g. from a shell alias:

```bash
alias cc='ccprofile auto && claude'
```

or a Claude Code `SessionStart` hook in `~/.claude/settings.json` (note that
skills are loaded at session start, so a switch triggered by the hook takes
effect on the *next* session):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "ccprofile auto" }] }
    ]
  }
}
```

Bindings are stored in `~/.claude/profiles/.bindings.json`.

## Profile schema

Profiles are JSON files with a `version` field (currently `2`). For the
`skills`, `agents`, and `commands` lists:

- **absent key** — leave that kind untouched when the profile is applied;
- **empty list `[]`** — disable everything of that kind (except protected
  items like the companion skill);
- **non-empty list** — keep exactly those items active.

Legacy profiles written before v0.4.0 (no `version` field) used `[]` to mean
"untouched"; they are normalized on load so their behavior does not change.

## Sharing profiles

Profiles are plain JSON, so you can version them or share them with your team:

```bash
ccprofile export docs > docs-profile.json     # or: ccprofile export docs docs-profile.json
ccprofile import docs-profile.json            # validates shape; --force to overwrite
curl -s https://example.com/team-docs.json | ccprofile import -
```

## How it works

Activation is **declarative**: the desired environment is computed as *your
original baseline overlaid with the profile*, so what you get is a pure
function of those two things — never of which profiles happened to be active
in between. When you run `ccprofile use <name>`:

1. **Skills**: Skills listed in the profile stay in `~/.claude/skills/`. All others are moved to `~/.claude/skills-disabled/`. The companion `ccprofile` skill is always kept active so `/profile-edit` never disappears.
2. **Agents & slash commands**: Same keep-list mechanism, using `~/.claude/agents[-disabled]/` and `~/.claude/commands[-disabled]/`. A profile with **no** list for a kind leaves that kind untouched; an **empty** list (`[]`) disables everything of that kind (except protected items).
3. **Plugins**: Sets `enabledPlugins` booleans in `~/.claude/settings.json` to the baseline values overlaid with the profile's toggles. Switching from profile A to profile B **reverts A's toggles** — they don't accumulate.
4. **MCP servers**: Same overlay semantics for `enabledMcpjsonServers` / `disabledMcpjsonServers`.

The first time you activate a profile from a clean state, ccprofile records a
**baseline snapshot** of your skills, agents, commands, plugins, and MCP
settings in `~/.claude/profiles/.baseline.json`. `ccprofile reset` restores
the baseline, touching **only what it recorded**: a skill you install or a
plugin you enable *while* a profile is active is unknown to the baseline and
is left exactly as you set it. Switching directly between profiles preserves
the original baseline.

The baseline captures **one** settings file — either the global
`~/.claude/settings.json` or a single project's `.claude/settings.json` (see
`--project` below). To keep `reset` able to fully undo everything, ccprofile
**refuses** to activate a profile against a different settings target while
another is still active (for example, a global activation while a `--project`
one is live). Run `ccprofile reset` first, then switch targets.

Profiles are stored as JSON files in `~/.claude/profiles/`.

### Project-level

Use `--project` to apply the settings changes (plugins, MCP servers) to the
current project's `.claude/settings.json` instead of global:

```bash
ccprofile use docs --project
```

Skills, agents, and slash commands always live in `~/.claude/` and are toggled
globally regardless of `--project`. `--project` is supported by `use`; `auto`
always targets the global settings file. Reset first before switching between a
project target and the global one (see above).

### Companion skill

After running `ccprofile init`, a `/profile-edit` slash command becomes available inside Claude Code. It is **non-auto-invocable** (zero token cost when idle) and only activates when you explicitly type `/profile-edit`. Use it when you want AI assistance to configure your profiles interactively.

## Important notes

- **Changes require a Claude Code restart.** Skills and plugins are loaded at session start, not mid-session.
- **Backups**: Before modifying `settings.json`, a timestamped backup is created automatically (keeps the 5 most recent).
- **Safe writes**: Uses atomic file writes, and activations are serialized through a lock file (`~/.claude/profiles/.lock`) so a `SessionStart` hook racing a manual command cannot interleave file moves. Stale locks from crashed runs are reclaimed automatically.
- **Non-destructive**: `ccprofile reset` restores the baseline captured before your first activation — skills, plugin toggles, and MCP server lists all return to their original state, while anything you installed or toggled *after* activation is left alone. The baseline tracks a single settings file, so activating against a different target (global vs. `--project`) while a profile is active is refused until you `reset`.
- **Health checks**: `ccprofile doctor` verifies the directories, settings files, profiles, bindings, baseline/marker consistency, and lock state, and flags items that exist in both an active and a disabled directory.

## Use from within Claude Code

Since this is a CLI tool, you can run it directly from a Claude Code session without consuming AI tokens:

```
! ccprofile use docs
```

## Why not an AI skill?

The whole point is to **save tokens**. Running profile management through AI would defeat the purpose. This tool runs entirely in your shell — zero API calls, zero token consumption.

The optional `/profile-edit` companion skill exists only for when you want AI help editing profiles. It uses `disable-model-invocation: true`, so it costs zero tokens until you explicitly invoke it.

## Caveats / compatibility

- **Coupled to Claude Code internals.** ccprofile relies on conventions that
  Claude Code does not formally document: that active skills/agents/commands
  live in `~/.claude/{skills,agents,commands}/` and are disabled by moving them
  to sibling `*-disabled/` directories, and that plugins and MCP servers are
  toggled through the `enabledPlugins`, `enabledMcpjsonServers`, and
  `disabledMcpjsonServers` keys in `settings.json`. If a Claude Code update
  changes how these are loaded or stored, ccprofile can silently stop having any
  effect until it is updated to match. It is not affiliated with Anthropic.
- **Token estimates are approximate.** `ccprofile stats` estimates idle cost
  from a `~4 chars/token` heuristic over each item's frontmatter name and
  description (including YAML block scalars like `description: >`). Context
  contributed by plugins and MCP servers is **not** counted at all — and it is
  often the largest share, since MCP tool schemas are only known at runtime.
  Treat the numbers as relative guidance for deciding what to disable, not as
  an exact accounting of your context window.
- **Changes apply on the next session.** Skills and plugins are loaded at
  session start, so any switch takes effect only after you restart Claude Code.
  This also means a switch triggered by a `SessionStart` hook is always one
  session behind.

## License

MIT
