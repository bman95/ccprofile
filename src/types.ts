export interface Profile {
  name: string;
  description?: string;
  plugins?: Record<string, boolean>;
  skills?: string[];
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
  /** Relevant slices of global settings.json at capture time. */
  settings: {
    enabledPlugins?: Record<string, boolean>;
    enabledMcpjsonServers?: string[];
    disabledMcpjsonServers?: string[];
  };
}
