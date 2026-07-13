#!/usr/bin/env node

import { argv, exit, cwd } from "node:process";
import {
  listProfiles,
  getProfile,
  saveProfile,
  deleteProfile,
  renameProfile,
  getActiveProfile,
  normalizeProfile,
} from "./profiles.js";
import { applyProfile, resetProfile } from "./apply.js";
import { runInit } from "./init.js";
import { computeStats } from "./stats.js";
import { listSkillDirs } from "./skills.js";
import { listItemNames, ALL_KINDS, AGENT_KIND, COMMAND_KIND } from "./items.js";
import { getBindings, setBinding, removeBinding, findBinding } from "./bindings.js";
import { validateProfileShape } from "./validate.js";
import { readJson } from "./config.js";
import { paths } from "./paths.js";
import { withLock } from "./lock.js";
import { runDoctor } from "./doctor.js";
import { CliError } from "./errors.js";
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

// Flags each command understands. Because ccprofile rearranges files under
// ~/.claude, both an unrecognized flag (the typo "--dryrun") and a recognized
// flag on the wrong command ("use --force") must be rejected up front rather
// than silently ignored.
const COMMAND_FLAGS: Record<string, string[]> = {
  init: [],
  use: ["--project", "--dry-run", "--json"],
  current: ["--json"],
  list: ["--json"],
  show: ["--json"],
  create: ["--json"],
  snapshot: ["--json"],
  rename: ["--json"],
  delete: ["--json"],
  reset: ["--dry-run", "--json"],
  stats: ["--json"],
  add: ["--enable", "--disable", "--json"],
  remove: ["--json"],
  bind: ["--json"],
  unbind: ["--json"],
  bindings: ["--json"],
  auto: ["--dry-run", "--json"],
  export: [],
  import: ["--force", "--json"],
  doctor: ["--json"],
};

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
  doctor                  Check the environment and ccprofile state for problems

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
  --json                  Machine-readable output
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

/**
 * Strip C0/C1 control characters (except tab/newline) from strings that may
 * contain untrusted content — imported profile descriptions, filesystem
 * names — so they cannot smuggle terminal escape sequences into output.
 */
function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
}

function out(human: string, data: unknown): void {
  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (human) {
    console.log(clean(human));
  }
}

/** Run a mutation under the activation lock; dry runs read only and skip it. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  return dryRun ? fn() : withLock(fn);
}

async function main(): Promise<void> {
  if (!command || command === "--help" || command === "-h" || flags.has("--help")) {
    console.log(HELP);
    return;
  }

  if (command === "--version" || command === "-v" || flags.has("--version")) {
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf-8"));
    console.log(pkg.version);
    return;
  }

  const allowed = COMMAND_FLAGS[command];
  if (allowed) {
    const bad = args.find((a) => a.startsWith("--") && !allowed.includes(a));
    if (bad) {
      const known = Object.values(COMMAND_FLAGS).some((fs) => fs.includes(bad));
      console.error(
        known
          ? `Flag ${bad} is not supported by "ccprofile ${command}".` +
              (allowed.length > 0 ? ` Supported: ${allowed.join(", ")}` : " It takes no flags.")
          : `Unknown flag: ${bad}\nRun "ccprofile --help" for usage.`
      );
      exit(1);
    }
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
    case "doctor":
      await cmdDoctor();
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
  const { applied, changes } = await locked(() => applyProfile(name, { projectDir, dryRun }));
  if (json) {
    out("", { profile: applied, dryRun, changes });
    return;
  }
  console.log(`Profile "${applied}" ${dryRun ? "(dry run) would be activated" : "activated"}.`);
  if (changes.length > 0) {
    for (const c of changes) console.log(clean(`  ${c}`));
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
    if (profile?.description) console.log(clean(`  ${profile.description}`));
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
  // A fresh profile declares nothing: every kind is left untouched until the
  // user adds items. (An empty LIST would mean "disable everything" since v2.)
  const profile: Profile = {
    name,
    description: description ?? "",
  };
  await saveProfile(profile);
  out(`Profile "${name}" created.`, { ok: true, created: name });
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

  // A snapshot records the exact current state of every kind — including
  // empty ones, since v2 semantics let an empty list round-trip as "none".
  const profile: Profile = {
    name,
    description: description ?? `Snapshot taken ${new Date().toISOString()}`,
    plugins: { ...(settings.enabledPlugins ?? {}) },
    skills,
    agents,
    commands,
    mcpServers,
  };
  await saveProfile(profile);
  out(
    `Profile "${name}" created from current environment ` +
      `(${skills.length} skills, ${agents.length} agents, ${commands.length} commands, ` +
      `${Object.keys(profile.plugins ?? {}).length} plugins, ` +
      `${Object.keys(mcpServers).length} MCP servers).`,
    { ok: true, created: name, skills, agents, commands }
  );
}

async function cmdRename(from: string | undefined, to: string | undefined): Promise<void> {
  if (!from || !to) {
    console.error("Usage: ccprofile rename <from> <to>");
    exit(1);
  }
  await renameProfile(from, to);
  out(`Profile "${from}" renamed to "${to}".`, { ok: true, renamed: { from, to } });
}

async function cmdDelete(name: string | undefined): Promise<void> {
  if (!name) {
    console.error("Usage: ccprofile delete <name>");
    exit(1);
  }
  if (await deleteProfile(name)) {
    out(`Profile "${name}" deleted.`, { ok: true, deleted: name });
  } else {
    console.error(`Profile "${name}" not found.`);
    exit(1);
  }
}

async function cmdReset(): Promise<void> {
  const changes = await locked(() => resetProfile({ dryRun }));
  if (json) {
    out("", { dryRun, changes });
    return;
  }
  for (const c of changes) console.log(clean(`  ${c}`));
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
      clean(`  ${mark} ${String(s.idleTokens).padStart(5)} tok  ${s.kind.padEnd(7)}  ${s.name}`)
    );
  }
  console.log(
    `\n  Total if all enabled: ~${stats.totalTokens} tokens` +
      `\n  Currently active:     ~${stats.currentActiveTokens} tokens\n`
  );
  console.log(
    "  Note: context contributed by plugins and MCP servers is NOT counted\n" +
      "  (tool schemas are only known at runtime); it is often the largest share.\n"
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

async function cmdDoctor(): Promise<void> {
  const results = await runDoctor();
  const failed = results.some((r) => r.level === "fail");
  if (json) {
    out("", { ok: !failed, results });
  } else {
    for (const r of results) {
      const tag = r.level === "ok" ? "[ok]  " : r.level === "warn" ? "[warn]" : "[FAIL]";
      console.log(clean(`  ${tag} ${r.message}`));
    }
    const warns = results.filter((r) => r.level === "warn").length;
    console.log(
      failed
        ? "\nProblems found. Fix the [FAIL] items above."
        : warns > 0
          ? `\nHealthy overall, ${warns} warning(s).`
          : "\nEverything looks healthy."
    );
  }
  if (failed) exit(1);
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
  let warning: string | undefined;

  if (type === "plugin") {
    profile.plugins ??= {};
    profile.plugins[name] = !isDisable;
  } else if (type === "mcp") {
    profile.mcpServers ??= {};
    profile.mcpServers[name] = !isDisable;
  } else if (type in LIST_TYPES) {
    const field = LIST_TYPES[type as keyof typeof LIST_TYPES];
    profile[field] ??= [];
    if (!profile[field]!.includes(name)) profile[field]!.push(name);
    const spec = ALL_KINDS.find((s) => s.plural === field)!;
    const known = new Set([
      ...(await listItemNames(spec.activeDir, spec.dirsOnly)),
      ...(await listItemNames(spec.disabledDir, spec.dirsOnly)),
    ]);
    if (!known.has(name)) {
      warning = `Warning: no ${type} named "${name}" is currently installed (kept anyway — it may be installed later).`;
    }
  } else {
    console.error(`Unknown type: ${type}. Use "plugin", "skill", "agent", "command", or "mcp".`);
    exit(1);
  }

  await saveProfile(profile);
  const verb = type === "plugin" || type === "mcp" ? ` (${isDisable ? "disabled" : "enabled"})` : "";
  out(
    `Added ${type} "${name}"${verb} to profile "${profileName}".` + (warning ? `\n${warning}` : ""),
    { ok: true, profile: profileName, type, name, warning }
  );
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
  } else if (type === "mcp") {
    if (profile.mcpServers) delete profile.mcpServers[name];
  } else if (type in LIST_TYPES) {
    const field = LIST_TYPES[type as keyof typeof LIST_TYPES];
    if (profile[field]) profile[field] = profile[field]!.filter((s) => s !== name);
  } else {
    console.error(`Unknown type: ${type}. Use "plugin", "skill", "agent", "command", or "mcp".`);
    exit(1);
  }

  await saveProfile(profile);
  out(`Removed ${type} "${name}" from profile "${profileName}".`, {
    ok: true,
    profile: profileName,
    type,
    name,
  });
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
  out(
    `Bound ${abs} → profile "${profileName}".\nRun "ccprofile auto" from inside that directory to activate it.`,
    { ok: true, dir: abs, profile: profileName }
  );
}

async function cmdUnbind(dir: string | undefined): Promise<void> {
  const target = dir ?? cwd();
  if (await removeBinding(target)) {
    out(`Removed binding for ${target}.`, { ok: true, dir: target });
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
  // Always reconcile, even when the marker already names this profile: the
  // profile may have been edited or the environment may have drifted since
  // activation, and re-applying an in-sync profile is a cheap no-op.
  const active = await getActiveProfile();
  const { changes } = await locked(() => applyProfile(match.profile, { dryRun }));
  const alreadyActive = active === match.profile && changes.length === 0;
  if (json) {
    out("", { matched: match, dryRun, alreadyActive, changes });
    return;
  }
  if (alreadyActive) {
    console.log(`Profile "${match.profile}" already active (bound to ${match.dir}).`);
    return;
  }
  console.log(
    `Profile "${match.profile}" ${dryRun ? "(dry run) would be activated" : "activated"} ` +
      `(bound to ${match.dir}).`
  );
  for (const c of changes) console.log(clean(`  ${c}`));
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
    throw new CliError("Invalid profile: input is not valid JSON.");
  }
  validateProfileShape(data);
  if ((await getProfile(data.name)) && !flags.has("--force")) {
    console.error(`Profile "${data.name}" already exists. Use --force to overwrite.`);
    exit(1);
  }
  // Copy only the known fields: imported JSON is untrusted, and arbitrary
  // extra keys must not ride along into ~/.claude/profiles/.
  const profile: Profile = {
    name: data.name,
    ...(data.version !== undefined ? { version: data.version } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(data.plugins !== undefined ? { plugins: data.plugins } : {}),
    ...(data.skills !== undefined ? { skills: data.skills } : {}),
    ...(data.agents !== undefined ? { agents: data.agents } : {}),
    ...(data.commands !== undefined ? { commands: data.commands } : {}),
    ...(data.mcpServers !== undefined ? { mcpServers: data.mcpServers } : {}),
  };
  await saveProfile(normalizeProfile(profile));
  out(`Profile "${data.name}" imported.`, { ok: true, imported: data.name });
}

main().catch((err) => {
  // Expected, user-facing failures print their message; anything else is a
  // bug and gets the full stack so it can actually be reported and fixed.
  if (err instanceof CliError) {
    console.error(err.message);
  } else {
    console.error(err?.stack ?? String(err));
  }
  exit(1);
});
