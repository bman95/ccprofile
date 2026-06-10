#!/usr/bin/env node

import { argv, exit, cwd } from "node:process";
import {
  listProfiles,
  getProfile,
  saveProfile,
  deleteProfile,
  renameProfile,
  getActiveProfile,
} from "./profiles.js";
import { applyProfile, resetProfile } from "./apply.js";
import { runInit } from "./init.js";
import { computeStats } from "./stats.js";
import { listSkillDirs } from "./skills.js";
import { readJson } from "./config.js";
import { paths } from "./paths.js";
import type { Profile, ClaudeSettings } from "./types.js";

const args = argv.slice(2);
const command = args[0];

// Strip flags so positional parsing stays simple.
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positionals = args.filter((a) => !a.startsWith("--"));
const projectFlag = flags.has("--project");
const dryRun = flags.has("--dry-run");
const json = flags.has("--json");
const projectDir = projectFlag ? cwd() : undefined;

const HELP = `
ccprofile — Profile manager for Claude Code

USAGE
  ccprofile <command> [options]

COMMANDS
  init                    Set up ccprofile (creates dirs, installs companion skill)
  use <name>              Activate a profile (applies plugins, skills, MCP changes)
  current                 Show the currently active profile and its impact
  list                    List all available profiles
  show <name>             Show profile details and estimated token savings
  create <name> [desc]    Create a new empty profile
  snapshot <name> [desc]  Capture the current environment as a new profile
  rename <from> <to>      Rename a profile
  delete <name>           Delete a profile
  reset                   Deactivate current profile, restore the original state
  stats                   Show per-skill token cost and per-profile savings

  add <profile> plugin <name> [--enable|--disable]
  add <profile> skill <name>
  add <profile> mcp <name> [--enable|--disable]
  remove <profile> <plugin|skill|mcp> <name>

OPTIONS
  --project               Apply to project-level settings instead of global
  --dry-run               Preview changes without writing anything
  --json                  Machine-readable output (use/current/list/show/stats/reset)
  --help, -h              Show this help message
  --version, -v           Show version

EXAMPLES
  ccprofile create docs "Document work"
  ccprofile add docs skill pdf
  ccprofile use docs --dry-run
  ccprofile snapshot my-current-setup
  ccprofile stats
`;

function out(human: string, data: unknown): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (human) {
    console.log(human);
  }
}

async function main(): Promise<void> {
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  if (command === "--version" || command === "-v") {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf-8"));
    console.log(pkg.version);
    return;
  }

  switch (command) {
    case "init":
      await runInit();
      break;
    case "use":
      await cmdUse(positionals[1]);
      break;
    case "current":
      await cmdCurrent();
      break;
    case "list":
      await cmdList();
      break;
    case "show":
      await cmdShow(positionals[1]);
      break;
    case "create":
      await cmdCreate(positionals[1], positionals[2]);
      break;
    case "snapshot":
      await cmdSnapshot(positionals[1], positionals[2]);
      break;
    case "rename":
      await cmdRename(positionals[1], positionals[2]);
      break;
    case "delete":
      await cmdDelete(positionals[1]);
      break;
    case "reset":
      await cmdReset();
      break;
    case "stats":
      await cmdStats();
      break;
    case "add":
      await cmdAdd(positionals.slice(1));
      break;
    case "remove":
      await cmdRemove(positionals.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}\nRun "ccprofile --help" for usage.`);
      exit(1);
  }
}

async function cmdUse(name: string | undefined): Promise<void> {
  if (!name) {
    console.error("Usage: ccprofile use <name>");
    exit(1);
  }
  const { applied, changes } = await applyProfile(name, { projectDir, dryRun });
  if (json) {
    out("", { profile: applied, dryRun, changes });
    return;
  }
  console.log(`Profile "${applied}" ${dryRun ? "(dry run) would be activated" : "activated"}.`);
  if (changes.length > 0) {
    for (const c of changes) console.log(`  ${c}`);
  } else {
    console.log("  (no changes — already in this state)");
  }
  if (!dryRun) console.log("\nRestart Claude Code for changes to take effect.");
}

async function cmdCurrent(): Promise<void> {
  const active = await getActiveProfile();
  const stats = await computeStats();
  const profile = active ? await getProfile(active) : null;
  if (json) {
    out("", {
      active,
      currentActiveTokens: stats.currentActiveTokens,
      totalTokens: stats.totalTokens,
      savedTokens: stats.totalTokens - stats.currentActiveTokens,
    });
    return;
  }
  if (!active) {
    console.log("No active profile.");
  } else {
    console.log(`Active profile: ${active}`);
    if (profile?.description) console.log(`  ${profile.description}`);
  }
  console.log(
    `Idle skill context: ~${stats.currentActiveTokens} tokens active ` +
      `(of ~${stats.totalTokens} if all skills enabled, ` +
      `saving ~${stats.totalTokens - stats.currentActiveTokens}).`
  );
}

async function cmdList(): Promise<void> {
  const profiles = await listProfiles();
  const active = await getActiveProfile();
  if (json) {
    out("", { active, profiles });
    return;
  }
  if (profiles.length === 0) {
    console.log("No profiles found. Create one with: ccprofile create <name>");
    return;
  }
  for (const p of profiles) {
    console.log(`  ${p}${p === active ? " (active)" : ""}`);
  }
}

async function cmdShow(name: string | undefined): Promise<void> {
  if (!name) {
    console.error("Usage: ccprofile show <name>");
    exit(1);
  }
  const profile = await getProfile(name);
  if (!profile) {
    console.error(`Profile "${name}" not found.`);
    exit(1);
  }
  const stats = await computeStats();
  const saving = stats.profiles.find((p) => p.name === name);
  if (json) {
    out("", { ...profile, saving });
    return;
  }
  console.log(JSON.stringify(profile, null, 2));
  if (saving) {
    console.log(
      `\nEstimated idle skill context when active: ~${saving.activeTokens} tokens ` +
        `(saves ~${saving.savedTokens} vs. all skills enabled).`
    );
  }
}

async function cmdCreate(name: string | undefined, description?: string): Promise<void> {
  if (!name) {
    console.error("Usage: ccprofile create <name> [description]");
    exit(1);
  }
  if (await getProfile(name)) {
    console.error(`Profile "${name}" already exists.`);
    exit(1);
  }
  const profile: Profile = {
    name,
    description: description ?? "",
    plugins: {},
    skills: [],
    mcpServers: {},
  };
  await saveProfile(profile);
  console.log(`Profile "${name}" created.`);
}

async function cmdSnapshot(name: string | undefined, description?: string): Promise<void> {
  if (!name) {
    console.error("Usage: ccprofile snapshot <name> [description]");
    exit(1);
  }
  if (await getProfile(name)) {
    console.error(`Profile "${name}" already exists.`);
    exit(1);
  }

  const skills = (await listSkillDirs(paths.skillsDir)).filter((s) => s !== "ccprofile");
  const settings = (await readJson<ClaudeSettings>(paths.settingsJson)) ?? {};

  const mcpServers: Record<string, boolean> = {};
  for (const s of settings.enabledMcpjsonServers ?? []) mcpServers[s] = true;
  for (const s of settings.disabledMcpjsonServers ?? []) mcpServers[s] = false;

  const profile: Profile = {
    name,
    description: description ?? `Snapshot taken ${new Date().toISOString()}`,
    plugins: { ...(settings.enabledPlugins ?? {}) },
    skills,
    mcpServers,
  };
  await saveProfile(profile);
  console.log(
    `Profile "${name}" created from current environment ` +
      `(${skills.length} skills, ${Object.keys(profile.plugins ?? {}).length} plugins, ` +
      `${Object.keys(mcpServers).length} MCP servers).`
  );
}

async function cmdRename(from: string | undefined, to: string | undefined): Promise<void> {
  if (!from || !to) {
    console.error("Usage: ccprofile rename <from> <to>");
    exit(1);
  }
  await renameProfile(from, to);
  console.log(`Profile "${from}" renamed to "${to}".`);
}

async function cmdDelete(name: string | undefined): Promise<void> {
  if (!name) {
    console.error("Usage: ccprofile delete <name>");
    exit(1);
  }
  if (await deleteProfile(name)) {
    console.log(`Profile "${name}" deleted.`);
  } else {
    console.error(`Profile "${name}" not found.`);
    exit(1);
  }
}

async function cmdReset(): Promise<void> {
  const changes = await resetProfile({ dryRun });
  if (json) {
    out("", { dryRun, changes });
    return;
  }
  for (const c of changes) console.log(`  ${c}`);
  if (!dryRun) console.log("\nRestart Claude Code for changes to take effect.");
}

async function cmdStats(): Promise<void> {
  const stats = await computeStats();
  if (json) {
    out("", stats);
    return;
  }
  console.log("Skill idle token cost (loaded into the system prompt every turn):\n");
  const sorted = [...stats.skills].sort((a, b) => b.idleTokens - a.idleTokens);
  for (const s of sorted) {
    const mark = s.active ? "[on] " : "[off]";
    console.log(`  ${mark} ${String(s.idleTokens).padStart(5)} tok  ${s.name}`);
  }
  console.log(
    `\n  Total if all enabled: ~${stats.totalTokens} tokens` +
      `\n  Currently active:     ~${stats.currentActiveTokens} tokens\n`
  );

  if (stats.profiles.length > 0) {
    console.log("Estimated savings per profile (vs. all skills enabled):\n");
    for (const p of [...stats.profiles].sort((a, b) => b.savedTokens - a.savedTokens)) {
      console.log(
        `  ${p.name.padEnd(16)} active ~${p.activeTokens} tok, saves ~${p.savedTokens} tok`
      );
    }
  }
}

async function cmdAdd(rest: string[]): Promise<void> {
  const [profileName, type, name] = rest;
  if (!profileName || !type || !name) {
    console.error("Usage: ccprofile add <profile> <plugin|skill|mcp> <name> [--enable|--disable]");
    exit(1);
  }

  const profile = await getProfile(profileName);
  if (!profile) {
    console.error(`Profile "${profileName}" not found.`);
    exit(1);
  }

  const isDisable = flags.has("--disable");

  switch (type) {
    case "plugin":
      profile.plugins ??= {};
      profile.plugins[name] = !isDisable;
      console.log(`Added plugin "${name}" (${isDisable ? "disabled" : "enabled"}) to profile "${profileName}".`);
      break;
    case "skill":
      profile.skills ??= [];
      if (!profile.skills.includes(name)) profile.skills.push(name);
      console.log(`Added skill "${name}" to profile "${profileName}".`);
      break;
    case "mcp":
      profile.mcpServers ??= {};
      profile.mcpServers[name] = !isDisable;
      console.log(`Added MCP server "${name}" (${isDisable ? "disabled" : "enabled"}) to profile "${profileName}".`);
      break;
    default:
      console.error(`Unknown type: ${type}. Use "plugin", "skill", or "mcp".`);
      exit(1);
  }

  await saveProfile(profile);
}

async function cmdRemove(rest: string[]): Promise<void> {
  const [profileName, type, name] = rest;
  if (!profileName || !type || !name) {
    console.error("Usage: ccprofile remove <profile> <plugin|skill|mcp> <name>");
    exit(1);
  }

  const profile = await getProfile(profileName);
  if (!profile) {
    console.error(`Profile "${profileName}" not found.`);
    exit(1);
  }

  switch (type) {
    case "plugin":
      if (profile.plugins) delete profile.plugins[name];
      console.log(`Removed plugin "${name}" from profile "${profileName}".`);
      break;
    case "skill":
      if (profile.skills) profile.skills = profile.skills.filter((s) => s !== name);
      console.log(`Removed skill "${name}" from profile "${profileName}".`);
      break;
    case "mcp":
      if (profile.mcpServers) delete profile.mcpServers[name];
      console.log(`Removed MCP server "${name}" from profile "${profileName}".`);
      break;
    default:
      console.error(`Unknown type: ${type}. Use "plugin", "skill", or "mcp".`);
      exit(1);
  }

  await saveProfile(profile);
}

main().catch((err) => {
  console.error(err.message);
  exit(1);
});
