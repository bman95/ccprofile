#!/usr/bin/env node

import { argv, exit, cwd } from "node:process";
import { listProfiles, getProfile, saveProfile, deleteProfile, getActiveProfile } from "./profiles.js";
import { applyProfile, resetProfile } from "./apply.js";
import type { Profile } from "./types.js";

const args = argv.slice(2);
const command = args[0];

const HELP = `
ccprofile — Profile manager for Claude Code

USAGE
  ccprofile <command> [options]

COMMANDS
  use <name>              Activate a profile (applies plugins, skills, MCP changes)
  current                 Show the currently active profile
  list                    List all available profiles
  show <name>             Show profile details
  create <name>           Create a new empty profile
  delete <name>           Delete a profile
  reset                   Deactivate current profile, restore all skills

  add <profile> plugin <name> [--enable|--disable]
                          Add a plugin toggle to a profile
  add <profile> skill <name>
                          Add a skill to a profile (skills listed are kept active)
  add <profile> mcp <name> [--enable|--disable]
                          Add an MCP server toggle to a profile

  remove <profile> plugin <name>
                          Remove a plugin from a profile
  remove <profile> skill <name>
                          Remove a skill from a profile
  remove <profile> mcp <name>
                          Remove an MCP server from a profile

OPTIONS
  --project               Apply to project-level settings instead of global
  --help, -h              Show this help message
  --version, -v           Show version

EXAMPLES
  ccprofile create docs
  ccprofile add docs plugin "frontend-design@claude-plugins-official" --disable
  ccprofile add docs skill pdf
  ccprofile add docs skill docx
  ccprofile use docs
  ccprofile current
  ccprofile reset
`;

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

  const projectFlag = args.includes("--project");
  const projectDir = projectFlag ? cwd() : undefined;

  switch (command) {
    case "use":
      await cmdUse(args[1], projectDir);
      break;
    case "current":
      await cmdCurrent();
      break;
    case "list":
      await cmdList();
      break;
    case "show":
      await cmdShow(args[1]);
      break;
    case "create":
      await cmdCreate(args[1], args[2]);
      break;
    case "delete":
      await cmdDelete(args[1]);
      break;
    case "reset":
      await cmdReset();
      break;
    case "add":
      await cmdAdd(args.slice(1));
      break;
    case "remove":
      await cmdRemove(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${command}\nRun "ccprofile --help" for usage.`);
      exit(1);
  }
}

async function cmdUse(name: string | undefined, projectDir?: string): Promise<void> {
  if (!name) {
    console.error('Usage: ccprofile use <name>');
    exit(1);
  }
  const { applied, changes } = await applyProfile(name, { projectDir });
  console.log(`Profile "${applied}" activated.`);
  if (changes.length > 0) {
    for (const c of changes) console.log(`  ${c}`);
  }
  console.log("\nRestart Claude Code for changes to take effect.");
}

async function cmdCurrent(): Promise<void> {
  const active = await getActiveProfile();
  if (active) {
    console.log(active);
  } else {
    console.log("No active profile.");
  }
}

async function cmdList(): Promise<void> {
  const profiles = await listProfiles();
  const active = await getActiveProfile();
  if (profiles.length === 0) {
    console.log("No profiles found. Create one with: ccprofile create <name>");
    return;
  }
  for (const p of profiles) {
    const marker = p === active ? " (active)" : "";
    console.log(`  ${p}${marker}`);
  }
}

async function cmdShow(name: string | undefined): Promise<void> {
  if (!name) {
    console.error('Usage: ccprofile show <name>');
    exit(1);
  }
  const profile = await getProfile(name);
  if (!profile) {
    console.error(`Profile "${name}" not found.`);
    exit(1);
  }
  console.log(JSON.stringify(profile, null, 2));
}

async function cmdCreate(name: string | undefined, description?: string): Promise<void> {
  if (!name) {
    console.error('Usage: ccprofile create <name> [description]');
    exit(1);
  }
  const existing = await getProfile(name);
  if (existing) {
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

async function cmdDelete(name: string | undefined): Promise<void> {
  if (!name) {
    console.error('Usage: ccprofile delete <name>');
    exit(1);
  }
  const deleted = await deleteProfile(name);
  if (deleted) {
    console.log(`Profile "${name}" deleted.`);
  } else {
    console.error(`Profile "${name}" not found.`);
    exit(1);
  }
}

async function cmdReset(): Promise<void> {
  const changes = await resetProfile();
  for (const c of changes) console.log(`  ${c}`);
  console.log("\nRestart Claude Code for changes to take effect.");
}

async function cmdAdd(args: string[]): Promise<void> {
  const [profileName, type, name, ...flags] = args;
  if (!profileName || !type || !name) {
    console.error('Usage: ccprofile add <profile> <plugin|skill|mcp> <name> [--enable|--disable]');
    exit(1);
  }

  const profile = await getProfile(profileName);
  if (!profile) {
    console.error(`Profile "${profileName}" not found.`);
    exit(1);
  }

  const isDisable = flags.includes("--disable");

  switch (type) {
    case "plugin":
      profile.plugins ??= {};
      profile.plugins[name] = !isDisable;
      console.log(`Added plugin "${name}" (${isDisable ? "disabled" : "enabled"}) to profile "${profileName}".`);
      break;
    case "skill":
      profile.skills ??= [];
      if (!profile.skills.includes(name)) {
        profile.skills.push(name);
      }
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

async function cmdRemove(args: string[]): Promise<void> {
  const [profileName, type, name] = args;
  if (!profileName || !type || !name) {
    console.error('Usage: ccprofile remove <profile> <plugin|skill|mcp> <name>');
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
      if (profile.skills) {
        profile.skills = profile.skills.filter((s) => s !== name);
      }
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
