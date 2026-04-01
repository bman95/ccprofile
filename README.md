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
# Create a profile for document work
ccprofile create docs "Document processing"

# Add skills that should stay active when this profile is used
ccprofile add docs skill pdf
ccprofile add docs skill docx
ccprofile add docs skill xlsx

# Disable plugins you don't need for doc work
ccprofile add docs plugin "frontend-design@claude-plugins-official" --disable

# Activate the profile (moves unused skills to ~/.claude/skills-disabled/)
ccprofile use docs

# Check what's active
ccprofile current

# Go back to normal (restore all skills)
ccprofile reset
```

## Commands

| Command | Description |
|---------|-------------|
| `ccprofile init` | Set up ccprofile (dirs, companion skill, environment scan) |
| `ccprofile use <name>` | Activate a profile |
| `ccprofile current` | Show active profile |
| `ccprofile list` | List all profiles |
| `ccprofile show <name>` | Show profile details |
| `ccprofile create <name> [desc]` | Create a new profile |
| `ccprofile delete <name>` | Delete a profile |
| `ccprofile reset` | Restore all skills, clear active profile |
| `ccprofile add <profile> plugin <name> [--enable\|--disable]` | Add plugin toggle |
| `ccprofile add <profile> skill <name>` | Add skill to profile |
| `ccprofile add <profile> mcp <name> [--enable\|--disable]` | Add MCP server toggle |
| `ccprofile remove <profile> plugin <name>` | Remove plugin from profile |
| `ccprofile remove <profile> skill <name>` | Remove skill from profile |
| `ccprofile remove <profile> mcp <name>` | Remove MCP server from profile |

## How it works

When you run `ccprofile use <name>`:

1. **Skills**: Skills listed in the profile stay in `~/.claude/skills/`. All others are moved to `~/.claude/skills-disabled/`.
2. **Plugins**: Toggles `enabledPlugins` booleans in `~/.claude/settings.json`.
3. **MCP servers**: Updates `enabledMcpjsonServers` / `disabledMcpjsonServers` in settings.

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
- **Non-destructive**: `ccprofile reset` restores all disabled skills. Your settings.json plugin entries are only toggled, never deleted.

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
