import { existsSync } from "node:fs";
import { mkdir, readdir, cp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "./paths.js";
import { readJson } from "./config.js";
import type { ClaudeSettings } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILL_DIR = join(__dirname, "..", "skill");

export async function runInit(): Promise<void> {
  console.log("ccprofile init\n");

  // 1. Check Claude Code is installed
  if (!existsSync(paths.claudeDir)) {
    console.error(
      "Error: ~/.claude/ not found. Is Claude Code installed?\n" +
      "Install it with: npm install -g @anthropic-ai/claude-code"
    );
    process.exit(1);
  }
  console.log("  [ok] Claude Code detected");

  // 2. Create profiles directory
  if (!existsSync(paths.profilesDir)) {
    await mkdir(paths.profilesDir, { recursive: true });
    console.log("  [ok] Created ~/.claude/profiles/");
  } else {
    const existing = await readdir(paths.profilesDir);
    const profiles = existing.filter((e) => e.endsWith(".json"));
    console.log(`  [ok] Profiles directory exists (${profiles.length} profiles found)`);
  }

  // 3. Create skills-disabled directory
  if (!existsSync(paths.skillsDisabledDir)) {
    await mkdir(paths.skillsDisabledDir, { recursive: true });
    console.log("  [ok] Created ~/.claude/skills-disabled/");
  } else {
    console.log("  [ok] Skills-disabled directory exists");
  }

  // 4. Install companion skill
  const skillDest = join(paths.skillsDir, "ccprofile");
  if (existsSync(BUNDLED_SKILL_DIR)) {
    await cp(BUNDLED_SKILL_DIR, skillDest, { recursive: true, force: true });
    console.log("  [ok] Installed /profile-edit skill to ~/.claude/skills/ccprofile/");
  } else {
    console.log("  [warn] Bundled skill not found — skipping skill installation");
  }

  // 5. Scan current environment
  console.log("\n--- Current environment ---\n");

  // Skills
  const activeSkills = existsSync(paths.skillsDir)
    ? (await readdir(paths.skillsDir)).filter((e) => e !== "ccprofile")
    : [];
  const disabledSkills = existsSync(paths.skillsDisabledDir)
    ? await readdir(paths.skillsDisabledDir)
    : [];

  if (activeSkills.length > 0) {
    console.log(`  Skills (active): ${activeSkills.join(", ")}`);
  }
  if (disabledSkills.length > 0) {
    console.log(`  Skills (disabled): ${disabledSkills.join(", ")}`);
  }

  // Plugins
  const settings = await readJson<ClaudeSettings>(paths.settingsJson);
  if (settings?.enabledPlugins) {
    const enabled = Object.entries(settings.enabledPlugins)
      .filter(([, v]) => v)
      .map(([k]) => k.replace(/@claude-plugins-official$/, ""));
    const disabled = Object.entries(settings.enabledPlugins)
      .filter(([, v]) => !v)
      .map(([k]) => k.replace(/@claude-plugins-official$/, ""));

    if (enabled.length > 0) {
      console.log(`  Plugins (enabled): ${enabled.join(", ")}`);
    }
    if (disabled.length > 0) {
      console.log(`  Plugins (disabled): ${disabled.join(", ")}`);
    }
  }

  // Suggestions
  console.log("\n--- Suggested profiles ---\n");

  const docSkills = activeSkills.filter((s) =>
    ["pdf", "docx", "pptx", "xlsx", "doc-coauthoring"].includes(s)
  );
  const browserSkills = activeSkills.filter((s) =>
    ["playwright-cli"].includes(s)
  );
  const githubSkills = activeSkills.filter((s) =>
    ["gh-issue", "issue-workflow", "fix-codex-comments"].includes(s)
  );
  const travelSkills = activeSkills.filter((s) =>
    ["travel-router", "eu-directive-transposition-tracker"].includes(s)
  );

  if (docSkills.length > 0) {
    console.log(`  docs: ${docSkills.join(", ")}`);
    console.log(`    ccprofile create docs "Document processing"`);
    for (const s of docSkills) {
      console.log(`    ccprofile add docs skill ${s}`);
    }
    console.log();
  }

  if (browserSkills.length > 0) {
    console.log(`  browser: ${browserSkills.join(", ")}`);
    console.log(`    ccprofile create browser "Browser automation"`);
    for (const s of browserSkills) {
      console.log(`    ccprofile add browser skill ${s}`);
    }
    console.log();
  }

  if (githubSkills.length > 0) {
    console.log(`  github: ${githubSkills.join(", ")}`);
    console.log(`    ccprofile create github "GitHub workflows"`);
    for (const s of githubSkills) {
      console.log(`    ccprofile add github skill ${s}`);
    }
    console.log();
  }

  if (travelSkills.length > 0) {
    console.log(`  travel: ${travelSkills.join(", ")}`);
    console.log(`    ccprofile create travel "Travel & research"`);
    for (const s of travelSkills) {
      console.log(`    ccprofile add travel skill ${s}`);
    }
    console.log();
  }

  const noSuggestions = [docSkills, browserSkills, githubSkills, travelSkills].every(
    (g) => g.length === 0
  );
  if (noSuggestions) {
    console.log("  No profile suggestions — create your own with: ccprofile create <name>");
  }

  console.log("\nTip: run \"ccprofile stats\" to see how many tokens each skill costs,");
  console.log("or \"ccprofile snapshot <name>\" to save your current setup as a profile.");
  console.log("\nDone! Run \"ccprofile --help\" to get started.");
}
