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
import { listItemNames, AGENT_KIND, COMMAND_KIND } from "./items.js";
import { getBindings, setBinding, removeBinding, findBinding } from "./bindings.js";
import { validateProfileShape } from "./validate.js";
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

// The full set of flags any command understands. Because ccprofile rearranges
// files under ~/.claude, an unrecognized flag (e.g. the typo "--dryrun") must
// be rejected up front rather than silently ignored — otherwise a mistyped
// "--dry-run" would perform a real activation.
const KNOWN_FLAGS = new Set([
  "--project",
  "--dry-run",
  "--json",
  "--force",
  "--enable",
  "--disable",
  "--help",
  "--version",
]);

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
  stats                   Show per-item token cost and per-profile savings

  add <profile> plugin <name> [--enable|--disable]
  add <profile> <skill|agent|command> <name>
  add <profile> mcp <name> [--enable|--disable]
  remove <profile> <plugin|skill|agent|command|mcp> <name>

  bind <profile> [dir]    Bind a directory (default: cwd) to a profile
  unbind [dir]            Remove a directory binding
  bindings                List directory bindings
  auto                    Activate the profile bound to the current directory
                          (applies to global settings only; use "use --project"
                          for project-level plugin/MCP changes)

  export <name> [file]    Export a profile as JSON (stdout if no file)
  import <file|->         Import a profile from JSON file or stdin [--force]

OPTIONS
  --project               Apply to project-level settings instead of global
                          (supported by "use"; "auto" is always global)
  --dry-run               Preview changes without writing anything
  --json                  Machine-readable output (use/current/list/show/stats/reset)
  --force                 Allow import to overwrite an existing profile
  --help, -h              Show this help message
  --version, -v           Show version

EXAMPLES
  ccprofile create docs "Document work"
  ccprofile add docs skill pdf
  ccprofile add docs agent code-reviewer
  ccprofile use docs --dry-run
  ccprofile bind docs ~/work/docs-repo
  ccprofile auto
  ccprofile export docs > docs-profile.json
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
  const unknownFlag = args.find((a) => a.startsWith("--") && !KNOWN_FLAGS.has(a));
  if (unknownFlag) {
    console.error(`Unknown flag: ${unknownFlag}\nRun "ccprofile --help" for usage.`);
    exit(1);
  }

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
    case "bind":
      await cmdBind(positionals[1], positionals[2]);
      break;
    case "unbind":
      await cmdUnbind(positionals[1]);
      break;
    case "bindings":
      await cmdBindings();
      break;
    case "auto":
      await cmdAuto();
      break;
    case "export":
      await cmdExport(positionals[1], positionals[2]);
      break;
    case "import":
      await cmdImport(positionals[1]);
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
    `Idle item context: ~${stats.currentActiveTokens} tokens active ` +
      `(of ~${stats.totalTokens} if all items enabled, ` +
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
      `\nEstimated idle item context when active: ~${saving.activeTokens} tokens ` +
        `(saves ~${saving.savedTokens} vs. all items enabled).`
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
  const agents = await listItemNames(AGENT_KIND.activeDir, AGENT_KIND.dirsOnly);
  const commands = await listItemNames(COMMAND_KIND.activeDir, COMMAND_KIND.dirsOnly);
  const settings = (await readJson<ClaudeSettings>(paths.settingsJson)) ?? {};

  const mcpServers: Record<string, boolean> = {};
  for (const s of settings.enabledMcpjsonServers ?? []) mcpServers[s] = true;
  for (const s of settings.disabledMcpjsonServers ?? []) mcpServers[s] = false;

  // An empty list means "leave this kind untouched" at apply time, so omit
  // kinds with nothing active instead of recording lists that can't round-trip.
  const profile: Profile = {
    name,
    description: description ?? `Snapshot taken ${new Date().toISOString()}`,
    plugins: { ...(settings.enabledPlugins ?? {}) },
    ...(skills.length > 0 ? { skills } : {}),
    ...(agents.length > 0 ? { agents } : {}),
    ...(commands.length > 0 ? { commands } : {}),
    mcpServers,
  };
  await saveProfile(profile);
  console.log(
    `Profile "${name}" created from current environment ` +
      `(${skills.length} skills, ${agents.length} agents, ${commands.length} commands, ` +
      `${Object.keys(profile.plugins ?? {}).length} plugins, ` +
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
  console.log("Idle token cost per item (loaded into the system prompt every turn):\n");
  const sorted = [...stats.items].sort((a, b) => b.idleTokens - a.idleTokens);
  for (const s of sorted) {
    const mark = s.active ? "[on] " : "[off]";
    console.log(
      `  ${mark} ${String(s.idleTokens).padStart(5)} tok  ${s.kind.padEnd(7)}  ${s.name}`
    );
  }
  console.log(
    `\n  Total if all enabled: ~${stats.totalTokens} tokens` +
      `\n  Currently active:     ~${stats.currentActiveTokens} tokens\n`
  );

  if (stats.profiles.length > 0) {
    console.log("Estimated savings per profile (vs. everything enabled):\n");
    for (const p of [...stats.profiles].sort((a, b) => b.savedTokens - a.savedTokens)) {
      console.log(
        `  ${p.name.padEnd(16)} active ~${p.activeTokens} tok, saves ~${p.savedTokens} tok`
      );
    }
  }
}

const LIST_TYPES = { skill: "skills", agent: "agents", command: "commands" } as const;

async function cmdAdd(rest: string[]): Promise<void> {
  const [profileName, type, name] = rest;
  if (!profileName || !type || !name) {
    console.error("Usage: ccprofile add <profile> <plugin|skill|agent|command|mcp> <name> [--enable|--disable]");
    exit(1);
  }

  const profile = await getProfile(profileName);
  if (!profile) {
    console.error(`Profile "${profileName}" not found.`);
    exit(1);
  }

  const isDisable = flags.has("--disable");

  if (type === "plugin") {
    profile.plugins ??= {};
    profile.plugins[name] = !isDisable;
    console.log(`Added plugin "${name}" (${isDisable ? "disabled" : "enabled"}) to profile "${profileName}".`);
  } else if (type === "mcp") {
    profile.mcpServers ??= {};
    profile.mcpServers[name] = !isDisable;
    console.log(`Added MCP server "${name}" (${isDisable ? "disabled" : "enabled"}) to profile "${profileName}".`);
  } else if (type in LIST_TYPES) {
    const field = LIST_TYPES[type as keyof typeof LIST_TYPES];
    profile[field] ??= [];
    if (!profile[field]!.includes(name)) profile[field]!.push(name);
    console.log(`Added ${type} "${name}" to profile "${profileName}".`);
  } else {
    console.error(`Unknown type: ${type}. Use "plugin", "skill", "agent", "command", or "mcp".`);
    exit(1);
  }

  await saveProfile(profile);
}

async function cmdRemove(rest: string[]): Promise<void> {
  const [profileName, type, name] = rest;
  if (!profileName || !type || !name) {
    console.error("Usage: ccprofile remove <profile> <plugin|skill|agent|command|mcp> <name>");
    exit(1);
  }

  const profile = await getProfile(profileName);
  if (!profile) {
    console.error(`Profile "${profileName}" not found.`);
    exit(1);
  }

  if (type === "plugin") {
    if (profile.plugins) delete profile.plugins[name];
    console.log(`Removed plugin "${name}" from profile "${profileName}".`);
  } else if (type === "mcp") {
    if (profile.mcpServers) delete profile.mcpServers[name];
    console.log(`Removed MCP server "${name}" from profile "${profileName}".`);
  } else if (type in LIST_TYPES) {
    const field = LIST_TYPES[type as keyof typeof LIST_TYPES];
    if (profile[field]) profile[field] = profile[field]!.filter((s) => s !== name);
    console.log(`Removed ${type} "${name}" from profile "${profileName}".`);
  } else {
    console.error(`Unknown type: ${type}. Use "plugin", "skill", "agent", "command", or "mcp".`);
    exit(1);
  }

  await saveProfile(profile);
}

async function cmdBind(profileName: string | undefined, dir: string | undefined): Promise<void> {
  if (!profileName) {
    console.error("Usage: ccprofile bind <profile> [dir]");
    exit(1);
  }
  if (!(await getProfile(profileName))) {
    console.error(`Profile "${profileName}" not found.`);
    exit(1);
  }
  const abs = await setBinding(dir ?? cwd(), profileName);
  console.log(`Bound ${abs} → profile "${profileName}".`);
  console.log(`Run "ccprofile auto" from inside that directory to activate it.`);
}

async function cmdUnbind(dir: string | undefined): Promise<void> {
  const target = dir ?? cwd();
  if (await removeBinding(target)) {
    console.log(`Removed binding for ${target}.`);
  } else {
    console.error(`No binding found for ${target}.`);
    exit(1);
  }
}

async function cmdBindings(): Promise<void> {
  const bindings = await getBindings();
  if (json) {
    out("", bindings);
    return;
  }
  const entries = Object.entries(bindings);
  if (entries.length === 0) {
    console.log("No directory bindings. Create one with: ccprofile bind <profile> [dir]");
    return;
  }
  for (const [dir, profile] of entries.sort()) {
    console.log(`  ${dir} → ${profile}`);
  }
}

async function cmdAuto(): Promise<void> {
  const bindings = await getBindings();
  const match = findBinding(bindings, cwd());
  if (!match) {
    if (json) out("", { matched: null });
    else console.log("No profile bound to this directory.");
    return;
  }
  const active = await getActiveProfile();
  if (active === match.profile && !dryRun) {
    if (json) out("", { matched: match, alreadyActive: true });
    else console.log(`Profile "${match.profile}" already active (bound to ${match.dir}).`);
    return;
  }
  const { changes } = await applyProfile(match.profile, { dryRun });
  if (json) {
    out("", { matched: match, dryRun, changes });
    return;
  }
  console.log(
    `Profile "${match.profile}" ${dryRun ? "(dry run) would be activated" : "activated"} ` +
      `(bound to ${match.dir}).`
  );
  for (const c of changes) console.log(`  ${c}`);
  if (!dryRun && changes.length > 0) console.log("\nRestart Claude Code for changes to take effect.");
}

async function cmdExport(name: string | undefined, file: string | undefined): Promise<void> {
  if (!name) {
    console.error("Usage: ccprofile export <name> [file]");
    exit(1);
  }
  const profile = await getProfile(name);
  if (!profile) {
    console.error(`Profile "${name}" not found.`);
    exit(1);
  }
  const data = JSON.stringify(profile, null, 2) + "\n";
  if (file) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, data, "utf-8");
    console.log(`Profile "${name}" exported to ${file}.`);
  } else {
    process.stdout.write(data);
  }
}

async function cmdImport(file: string | undefined): Promise<void> {
  if (!file) {
    console.error("Usage: ccprofile import <file|-> [--force]");
    exit(1);
  }
  let raw: string;
  if (file === "-") {
    // readFileSync(0) fails with EAGAIN on non-blocking pipes; stream instead.
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    raw = Buffer.concat(chunks).toString("utf-8");
  } else {
    const { readFile } = await import("node:fs/promises");
    raw = await readFile(file, "utf-8");
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid profile: input is not valid JSON.");
  }
  validateProfileShape(data);
  if ((await getProfile(data.name)) && !flags.has("--force")) {
    console.error(`Profile "${data.name}" already exists. Use --force to overwrite.`);
    exit(1);
  }
  await saveProfile(data);
  console.log(`Profile "${data.name}" imported.`);
}

main().catch((err) => {
  console.error(err.message);
  exit(1);
});
