---
name: profile-edit
description: Edit ccprofile profiles — add/remove skills, plugins, MCP servers to named profiles
disable-model-invocation: true
allowed-tools: Bash(ccprofile *), Read, Glob
argument-hint: [action] [profile-name]
---

# Profile Editor

You are helping the user manage their `ccprofile` profiles. Profiles control which Claude Code skills, plugins, and MCP servers are active to optimize context window usage.

## Available commands

Run these via Bash to inspect and modify profiles:

```bash
ccprofile list                    # List all profiles
ccprofile show <name>             # Show profile details
ccprofile current                 # Show active profile
ccprofile create <name> [desc]    # Create new profile
ccprofile delete <name>           # Delete profile

ccprofile add <profile> skill <name>              # Add skill
ccprofile add <profile> plugin <name> [--enable|--disable]  # Add plugin toggle
ccprofile add <profile> mcp <name> [--enable|--disable]     # Add MCP toggle

ccprofile remove <profile> skill <name>           # Remove skill
ccprofile remove <profile> plugin <name>           # Remove plugin
ccprofile remove <profile> mcp <name>              # Remove MCP server

ccprofile use <name>              # Activate profile
ccprofile reset                   # Restore all skills
```

## Context

- Skills live in `~/.claude/skills/` (active) and `~/.claude/skills-disabled/` (inactive)
- Plugins are toggled in `~/.claude/settings.json` under `enabledPlugins`
- MCP servers are managed via `enabledMcpjsonServers` / `disabledMcpjsonServers`
- Profiles are stored as JSON in `~/.claude/profiles/<name>.json`

## Workflow

When the user asks to edit a profile:

1. Run `ccprofile list` and `ccprofile current` to understand the current state
2. If they want to see what skills/plugins are available, check `~/.claude/skills/`, `~/.claude/skills-disabled/`, and `~/.claude/settings.json`
3. Use `ccprofile add` / `ccprofile remove` commands to modify the profile
4. Show the result with `ccprofile show <name>`
5. Ask if they want to activate with `ccprofile use <name>`
6. Remind them to restart Claude Code for changes to take effect

When the user provides `$ARGUMENTS`, interpret the intent:

- `/profile-edit list` → show profiles
- `/profile-edit docs add skill pdf` → add pdf skill to docs profile
- `/profile-edit create backend` → create a new backend profile
- `/profile-edit suggest` → analyze current skills/plugins and suggest profile groupings
