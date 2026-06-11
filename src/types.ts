export interface Profile {
  name: string;
  description?: string;
  plugins?: Record<string, boolean>;
  skills?: string[];
  /** Subagents (~/.claude/agents/) kept active when this profile is used. */
  agents?: string[];
  /** Slash commands (~/.claude/commands/) kept active when this profile is used. */
  commands?: string[];
  mcpServers?: Record<string, boolean>;
}

export interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];
  [key: string]: unknown;
}

/**
 * Snapshot of the environment captured the first time a profile is activated
 * from a clean state. `ccprofile reset` restores exactly this, which makes
 * profile activation fully reversible (skills, plugins, and MCP servers).
 */
export interface Baseline {
  capturedAt: string;
  /** Skills that were active (in ~/.claude/skills/) at capture time. */
  activeSkills: string[];
  /** Agents active at capture time (absent in baselines from v0.2). */
  activeAgents?: string[];
  /** Slash commands active at capture time (absent in baselines from v0.2). */
  activeCommands?: string[];
  /**
   * Settings file the `settings` slice was captured from (e.g. a project
   * settings.json when activated with --project). Absent in older baselines,
   * which were always captured from the global settings.json.
   */
  settingsPath?: string;
  /** Relevant slices of settings.json at capture time. */
  settings: {
    enabledPlugins?: Record<string, boolean>;
    enabledMcpjsonServers?: string[];
    disabledMcpjsonServers?: string[];
  };
}
