import { homedir } from "node:os";
import { join } from "node:path";

const CLAUDE_DIR = join(homedir(), ".claude");

export const paths = {
  claudeDir: CLAUDE_DIR,
  settingsJson: join(CLAUDE_DIR, "settings.json"),
  profilesDir: join(CLAUDE_DIR, "profiles"),
  skillsDir: join(CLAUDE_DIR, "skills"),
  skillsDisabledDir: join(CLAUDE_DIR, "skills-disabled"),
  activeProfileFile: join(CLAUDE_DIR, "profiles", ".active"),

  projectSettings(projectDir: string) {
    return join(projectDir, ".claude", "settings.json");
  },

  projectLocalSettings(projectDir: string) {
    return join(projectDir, ".claude", "settings.local.json");
  },

  profileFile(name: string) {
    return join(CLAUDE_DIR, "profiles", `${name}.json`);
  },
};
