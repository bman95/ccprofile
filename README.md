# ccprofile

Profile manager for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — toggle groups of skills, plugins, and MCP servers to optimize your context window.

## The problem

Claude Code loads **all** registered skills, plugins, and MCP server definitions into the system prompt on every turn. With 30+ skills installed, this wastes thousands of tokens even when most capabilities aren't needed for the current task.

## The solution

`ccprofile` lets you define named profiles that group skills, plugins, and MCP servers. Switch between them with a single command to keep only what you need in your context window.

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
| `ccprofile stats` | Show per-skill token cost and per-profile savings |
| `ccprofile add <profile> plugin <name> [--enable\|--disable]` | Add plugin toggle |
| `ccprofile add <profile> skill <name>` | Add skill to profile |
| `ccprofile add <profile> mcp <name> [--enable\|--disable]` | Add MCP server toggle |
| `ccprofile remove <profile> plugin <name>` | Remove plugin from profile |
| `ccprofile remove <profile> skill <name>` | Remove skill from profile |
| `ccprofile remove <profile> mcp <name>` | Remove MCP server from profile |

All read commands accept `--json` for scripting. `use` and `reset` accept `--dry-run`
to preview changes without writing anything.

## Measuring token savings

The whole point of ccprofile is to shrink the system prompt, so it can show you
exactly what that costs. Claude Code loads each skill's metadata (name +
description) into the system prompt on every turn until the skill is actually
invoked. `ccprofile stats` estimates that recurring idle cost per skill and how
much each profile saves:

```
$ ccprofile stats
Skill idle token cost (loaded into the system prompt every turn):

  [on]    180 tok  playwright-cli
  [on]     95 tok  pdf
  [off]     0 tok  ccprofile          # non-auto-invocable → ~0 idle cost

  Total if all enabled: ~620 tokens
  Currently active:     ~275 tokens

Estimated savings per profile (vs. all skills enabled):

  docs             active ~190 tok, saves ~430 tok
```

Estimates use a ~4 chars/token heuristic over each skill's frontmatter, and
skills marked `disable-model-invocation: true` are counted as ~0 since they are
not auto-loaded.

## How it works

When you run `ccprofile use <name>`:

1. **Skills**: Skills listed in the profile stay in `~/.claude/skills/`. All others are moved to `~/.claude/skills-disabled/`. The companion `ccprofile` skill is always kept active so `/profile-edit` never disappears.
2. **Plugins**: Toggles `enabledPlugins` booleans in `~/.claude/settings.json`.
3. **MCP servers**: Updates `enabledMcpjsonServers` / `disabledMcpjsonServers` in settings.

The first time you activate a profile from a clean state, ccprofile records a
**baseline snapshot** of your skills, plugins, and MCP settings in
`~/.claude/profiles/.baseline.json`. `ccprofile reset` restores that exact
baseline — so deactivating is fully reversible, even for plugins and MCP servers
a profile turned off. Switching directly between profiles preserves the original
baseline.

Profiles are stored as JSON files in `~/.claude/profiles/`.

### Project-level

Use `--project` to apply changes to the current project's `.claude/settings.json` instead of global:

```bash
ccprofile use docs --project
```

### Companion skill

After running `ccprofile init`, a `/profile-edit` slash command becomes available inside Claude Code. It is **non-auto-invocable** (zero token cost when idle) and only activates when you explicitly type `/profile-edit`. Use it when you want AI assistance to configure your profiles interactively.

## Important notes

- **Changes require a Claude Code restart.** Skills and plugins are loaded at session start, not mid-session.
- **Backups**: Before modifying `settings.json`, a timestamped backup is created automatically (keeps the 5 most recent).
- **Safe writes**: Uses atomic file writes to prevent corruption from concurrent access.
- **Non-destructive**: `ccprofile reset` restores the baseline captured before your first activation — skills, plugin toggles, and MCP server lists all return to their original state.

## Use from within Claude Code

Since this is a CLI tool, you can run it directly from a Claude Code session without consuming AI tokens:

```
! ccprofile use docs
```

## Why not an AI skill?

The whole point is to **save tokens**. Running profile management through AI would defeat the purpose. This tool runs entirely in your shell — zero API calls, zero token consumption.

The optional `/profile-edit` companion skill exists only for when you want AI help editing profiles. It uses `disable-model-invocation: true`, so it costs zero tokens until you explicitly invoke it.

## License

MIT
