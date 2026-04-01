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
