export interface Profile {
  name: string;
  /**
   * Profile schema version. Version 2 (v0.4.0+): an absent list means "leave
   * this kind untouched" and an empty list means "disable everything of this
   * kind (except protected items)". Legacy profiles (no version field) treated
   * empty lists as untouched, so they are normalized on load: empty lists are
   * dropped, preserving their original meaning.
   */
  version?: number;
  description?: string;
  plugins?: Record<string, boolean>;
  skills?: string[];
  /** Subagents (~/.claude/agents/) kept active when this profile is used. */
  agents?: string[];
  /** Slash commands (~/.claude/commands/) kept active when this profile is used. */
  commands?: string[];
  mcpServers?: Record<string, boolean>;
}

/** Current profile schema version written by saveProfile. */
export const PROFILE_VERSION = 2;

export interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>;
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];
  [key: string]: unknown;
}

/**
 * Snapshot of the environment captured the first time a profile is activated
 * from a clean state. Activation computes the desired state as *baseline
 * overlaid with the profile*, and `ccprofile reset` restores the baseline —
 * touching only what it recorded, so items installed or removed while a
 * profile was active are left alone.
 */
export interface Baseline {
  capturedAt: string;
  /** Skills that were active (in ~/.claude/skills/) at capture time. */
  activeSkills: string[];
  /** Agents active at capture time (absent in baselines from v0.2). */
  activeAgents?: string[];
  /** Slash commands active at capture time (absent in baselines from v0.2). */
  activeCommands?: string[];
  /** Skills disabled at capture time (absent in baselines before v0.4). */
  disabledSkills?: string[];
  /** Agents disabled at capture time (absent in baselines before v0.4). */
  disabledAgents?: string[];
  /** Commands disabled at capture time (absent in baselines before v0.4). */
  disabledCommands?: string[];
  /**
   * Plugin keys any profile has toggled since the baseline was captured.
   * Keys in this list but absent from the baseline settings were introduced
   * by a profile and are removed again when no profile declares them.
   */
  managedPlugins?: string[];
  /** MCP server names any profile has toggled since capture (see managedPlugins). */
  managedMcpServers?: string[];
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
