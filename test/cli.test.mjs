import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "..", "dist", "cli.js");

let HOME;
let claudeDir;

function run(args, opts = {}) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      env: { ...process.env, HOME, USERPROFILE: HOME },
      encoding: "utf-8",
      cwd: opts.cwd,
      input: opts.input,
    });
    return { stdout, code: 0 };
  } catch (err) {
    if (opts.allowFail) {
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.status ?? 1 };
    }
    throw err;
  }
}

function makeMdItem(dir, name, { description = "" } = {}) {
  mkdirSync(dir, { recursive: true });
  const fm = ["---", `name: ${name}`, `description: ${description}`, "---", "", "Body."].join("\n");
  writeFileSync(join(dir, `${name}.md`), fm);
}

function makeSkill(dir, name, { description = "", disableInvocation = false } = {}) {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const fm = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    ...(disableInvocation ? ["disable-model-invocation: true"] : []),
    "---",
    "",
    "Body content here.",
  ].join("\n");
  writeFileSync(join(skillDir, "SKILL.md"), fm);
}

function readSettings() {
  return JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf-8"));
}

// The CLI is built by the npm test script before any test runs.
beforeEach(() => {
  HOME = mkdtempSync(join(tmpdir(), "ccprofile-test-"));
  claudeDir = join(HOME, ".claude");
  mkdirSync(join(claudeDir, "skills"), { recursive: true });
  makeSkill(join(claudeDir, "skills"), "pdf", { description: "Work with PDF files and forms" });
  makeSkill(join(claudeDir, "skills"), "docx", { description: "Edit Word documents" });
  makeSkill(join(claudeDir, "skills"), "playwright", { description: "Drive a browser for automation tasks" });
  makeSkill(join(claudeDir, "skills"), "ccprofile", { description: "edit profiles", disableInvocation: true });
  makeMdItem(join(claudeDir, "agents"), "reviewer", { description: "Reviews code for bugs" });
  makeMdItem(join(claudeDir, "agents"), "tester", { description: "Writes and runs tests" });
  makeMdItem(join(claudeDir, "commands"), "deploy", { description: "Deploy the app" });
  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({ enabledPlugins: { "frontend-design@x": true } }, null, 2)
  );
});

afterEach(() => {
  if (HOME && existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
});

test("create, list, and show a profile", () => {
  run(["create", "docs", "Document work"]);
  const list = run(["list"]).stdout;
  assert.match(list, /docs/);
  const show = run(["show", "docs"]).stdout;
  assert.match(show, /"name": "docs"/);
  assert.match(show, /Document work/);
});

test("invalid profile names are rejected", () => {
  const res = run(["create", "../evil"], { allowFail: true });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /Invalid profile name/);
});

test("use moves non-profile skills to disabled but keeps the companion skill", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);
  run(["use", "docs"]);

  assert.ok(existsSync(join(claudeDir, "skills", "pdf")), "pdf stays active");
  assert.ok(existsSync(join(claudeDir, "skills", "ccprofile")), "companion stays active");
  assert.ok(existsSync(join(claudeDir, "skills-disabled", "docx")), "docx disabled");
  assert.ok(existsSync(join(claudeDir, "skills-disabled", "playwright")), "playwright disabled");
});

test("reset restores skills AND plugin/mcp state from baseline", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);
  run(["add", "docs", "plugin", "frontend-design@x", "--disable"]);
  run(["use", "docs"]);

  assert.equal(readSettings().enabledPlugins["frontend-design@x"], false, "plugin disabled by profile");
  assert.ok(existsSync(join(claudeDir, "skills-disabled", "docx")));

  run(["reset"]);

  assert.equal(readSettings().enabledPlugins["frontend-design@x"], true, "plugin restored");
  assert.ok(existsSync(join(claudeDir, "skills", "docx")), "docx restored");
  assert.ok(existsSync(join(claudeDir, "skills", "playwright")), "playwright restored");
  assert.equal(run(["current"]).stdout.includes("No active profile"), true);
});

test("dry-run makes no changes", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);
  const res = run(["use", "docs", "--dry-run"]);
  assert.match(res.stdout, /dry run/);
  assert.ok(!existsSync(join(claudeDir, "skills-disabled", "docx")), "nothing moved in dry-run");
  assert.equal(run(["current"]).stdout.includes("No active profile"), true);
});

test("snapshot captures the current environment", () => {
  run(["snapshot", "now", "my setup"]);
  const show = JSON.parse(run(["show", "now", "--json"]).stdout);
  assert.deepEqual(show.skills.sort(), ["docx", "pdf", "playwright"]);
  assert.equal(show.plugins["frontend-design@x"], true);
});

test("rename a profile", () => {
  run(["create", "old"]);
  run(["rename", "old", "new"]);
  assert.match(run(["list"]).stdout, /new/);
  const res = run(["show", "old"], { allowFail: true });
  assert.equal(res.code, 1);
});

test("stats reports token costs and savings for skills, agents, and commands", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);
  const stats = JSON.parse(run(["stats", "--json"]).stdout);
  assert.ok(stats.totalTokens > 0);
  const pdf = stats.items.find((s) => s.name === "pdf");
  assert.ok(pdf.idleTokens > 0, "auto-invocable skill has idle cost");
  const companion = stats.items.find((s) => s.name === "ccprofile");
  assert.equal(companion.idleTokens, 0, "non-auto-invocable skill costs ~0");
  const agent = stats.items.find((s) => s.name === "reviewer");
  assert.equal(agent.kind, "agent");
  assert.ok(agent.idleTokens > 0, "agents have idle cost");
  const command = stats.items.find((s) => s.name === "deploy");
  assert.equal(command.kind, "command");
  assert.ok(command.idleTokens > 0, "commands have idle cost");
  const docs = stats.profiles.find((p) => p.name === "docs");
  assert.ok(docs.savedTokens > 0, "profile saves tokens");
});

test("profiles toggle agents and commands, and reset restores them", () => {
  run(["create", "review"]);
  run(["add", "review", "skill", "pdf"]);
  run(["add", "review", "agent", "reviewer"]);
  run(["add", "review", "command", "deploy"]);
  run(["use", "review"]);

  assert.ok(existsSync(join(claudeDir, "agents", "reviewer.md")), "kept agent stays");
  assert.ok(existsSync(join(claudeDir, "agents-disabled", "tester.md")), "other agent disabled");
  assert.ok(existsSync(join(claudeDir, "commands", "deploy.md")), "kept command stays");

  run(["reset"]);
  assert.ok(existsSync(join(claudeDir, "agents", "tester.md")), "agent restored");
  assert.ok(!existsSync(join(claudeDir, "agents-disabled", "tester.md")));
});

test("a profile that declares no agents leaves agents untouched", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);
  run(["use", "docs"]);
  assert.ok(existsSync(join(claudeDir, "agents", "reviewer.md")));
  assert.ok(existsSync(join(claudeDir, "agents", "tester.md")));
});

test("bind/auto activates the bound profile from a subdirectory", () => {
  run(["create", "work"]);
  run(["add", "work", "skill", "pdf"]);
  const repo = join(HOME, "myrepo");
  const sub = join(repo, "src", "deep");
  mkdirSync(sub, { recursive: true });

  run(["bind", "work", repo]);
  assert.match(run(["bindings"]).stdout, /myrepo.*work/);

  const res = run(["auto"], { cwd: sub });
  assert.match(res.stdout, /Profile "work" activated/);
  assert.ok(existsSync(join(claudeDir, "skills-disabled", "docx")));

  // Second invocation is a no-op.
  assert.match(run(["auto"], { cwd: sub }).stdout, /already active/);

  // Outside the bound tree, nothing happens.
  assert.match(run(["auto"], { cwd: HOME }).stdout, /No profile bound/);

  run(["unbind", repo]);
  assert.match(run(["bindings"]).stdout, /No directory bindings/);
});

test("export/import roundtrip and validation", () => {
  run(["create", "docs", "Doc work"]);
  run(["add", "docs", "skill", "pdf"]);
  run(["add", "docs", "agent", "reviewer"]);

  const exported = run(["export", "docs"]).stdout;
  run(["delete", "docs"]);

  run(["import", "-"], { input: exported });
  const show = JSON.parse(run(["show", "docs", "--json"]).stdout);
  assert.deepEqual(show.skills, ["pdf"]);
  assert.deepEqual(show.agents, ["reviewer"]);

  // Re-import without --force fails; with --force succeeds.
  const dup = run(["import", "-"], { input: exported, allowFail: true });
  assert.equal(dup.code, 1);
  assert.match(dup.stderr, /already exists/);
  run(["import", "-", "--force"], { input: exported });

  // Malformed profiles are rejected.
  const bad = run(["import", "-"], { input: '{"name":"x","skills":"nope"}', allowFail: true });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /must be an array of strings/);
  const traversal = run(["import", "-"], { input: '{"name":"../evil"}', allowFail: true });
  assert.equal(traversal.code, 1);
});

test("current and stats work while a profile (and baseline) is active", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);
  run(["use", "docs"]);
  // The internal .baseline.json must not leak into profile listings.
  const cur = run(["current"]);
  assert.match(cur.stdout, /Active profile: docs/);
  const list = run(["list"]).stdout;
  assert.ok(!list.includes("baseline"), "baseline not listed as a profile");
  const stats = run(["stats", "--json"]);
  assert.equal(stats.code, 0);
});

test("rename updates the active marker and directory bindings", () => {
  run(["create", "old"]);
  run(["add", "old", "skill", "pdf"]);
  const repo = join(HOME, "repo");
  mkdirSync(repo, { recursive: true });
  run(["bind", "old", repo]);
  run(["use", "old"]);

  run(["rename", "old", "new"]);

  assert.match(run(["current"]).stdout, /Active profile: new/);
  assert.match(run(["bindings"]).stdout, /repo.*new/);
  assert.match(run(["auto"], { cwd: repo }).stdout, /already active/);
});

test("delete removes directory bindings for the profile", () => {
  run(["create", "tmp"]);
  const repo = join(HOME, "repo");
  mkdirSync(repo, { recursive: true });
  run(["bind", "tmp", repo]);

  run(["delete", "tmp"]);

  assert.match(run(["bindings"]).stdout, /No directory bindings/);
  assert.match(run(["auto"], { cwd: repo }).stdout, /No profile bound/);
});

test("use --project applies and reset restores project settings", () => {
  const proj = join(HOME, "proj");
  mkdirSync(join(proj, ".claude"), { recursive: true });
  const projSettingsFile = join(proj, ".claude", "settings.json");
  writeFileSync(projSettingsFile, JSON.stringify({ enabledPlugins: { "p@x": true } }, null, 2));
  const projSettings = () => JSON.parse(readFileSync(projSettingsFile, "utf-8"));

  run(["create", "docs"]);
  run(["add", "docs", "plugin", "p@x", "--disable"]);
  run(["use", "docs", "--project"], { cwd: proj });
  assert.equal(projSettings().enabledPlugins["p@x"], false, "project plugin disabled");

  run(["reset"]);
  assert.equal(projSettings().enabledPlugins["p@x"], true, "project settings restored by reset");
});

test("snapshot records empty kinds explicitly (v2: [] round-trips as 'none')", () => {
  rmSync(join(claudeDir, "agents"), { recursive: true, force: true });
  run(["snapshot", "snap"]);
  const show = JSON.parse(run(["show", "snap", "--json"]).stdout);
  assert.deepEqual(show.agents, [], "empty kind recorded as [] so the exact state round-trips");
  assert.equal(show.version, 2, "snapshot uses profile schema v2");
  assert.ok(show.skills.length > 0);
});

test("import rejects unsafe item names", () => {
  const res = run(["import", "-"], { input: '{"name":"x","skills":["../evil"]}', allowFail: true });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /unsafe item name/);
});

test("export writes a profile to a file", () => {
  run(["create", "docs", "Doc work"]);
  const file = join(HOME, "out.json");
  run(["export", "docs", file]);
  assert.equal(JSON.parse(readFileSync(file, "utf-8")).name, "docs");
});

test("switching profiles does not corrupt the baseline", () => {
  run(["create", "a"]);
  run(["add", "a", "skill", "pdf"]);
  run(["create", "b"]);
  run(["add", "b", "skill", "docx"]);

  run(["use", "a"]);
  run(["use", "b"]);
  // After reset we should be back to the ORIGINAL state, not profile a's state.
  run(["reset"]);
  for (const s of ["pdf", "docx", "playwright"]) {
    assert.ok(existsSync(join(claudeDir, "skills", s)), `${s} restored to original`);
  }
});

test("unknown flags are rejected before any mutation", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);

  // --dryrun is a typo for --dry-run; it must not perform a real activation.
  const res = run(["use", "docs", "--dryrun"], { allowFail: true });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /Unknown flag: --dryrun/);

  assert.ok(!existsSync(join(claudeDir, "skills-disabled", "docx")), "no skills moved");
  assert.equal(run(["current"]).stdout.includes("No active profile"), true);
});

test("mixing --project and global activations is refused, keeping reset reversible", () => {
  const proj = join(HOME, "proj");
  mkdirSync(join(proj, ".claude"), { recursive: true });
  const projSettingsFile = join(proj, ".claude", "settings.json");
  writeFileSync(projSettingsFile, JSON.stringify({ enabledPlugins: { "p@x": true } }, null, 2));
  const projSettings = () => JSON.parse(readFileSync(projSettingsFile, "utf-8"));

  run(["create", "a"]);
  run(["add", "a", "plugin", "p@x", "--disable"]);
  run(["create", "b"]);
  run(["add", "b", "plugin", "frontend-design@x", "--disable"]);

  // First activation targets the PROJECT settings file.
  run(["use", "a", "--project"], { cwd: proj });
  assert.equal(projSettings().enabledPlugins["p@x"], false, "project plugin disabled");

  const globalBefore = readFileSync(join(claudeDir, "settings.json"), "utf-8");

  // Second activation targets the GLOBAL settings file — must be refused.
  const res = run(["use", "b"], { allowFail: true });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /reset/i);

  // The global settings file is byte-identical: no mutation happened.
  assert.equal(readFileSync(join(claudeDir, "settings.json"), "utf-8"), globalBefore);
  assert.equal(readSettings().enabledPlugins["frontend-design@x"], true, "global plugin untouched");

  // reset fully restores the (project) file the baseline captured.
  run(["reset"]);
  assert.equal(projSettings().enabledPlugins["p@x"], true, "project settings restored by reset");
});

test("corrupted settings.json aborts the command without overwriting it", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);

  const settingsFile = join(claudeDir, "settings.json");
  const corrupt = "{ this is not valid json ]";
  writeFileSync(settingsFile, corrupt);

  const res = run(["use", "docs"], { allowFail: true });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /invalid JSON/i);

  // The user's corrupted file is left exactly as they wrote it.
  assert.equal(readFileSync(settingsFile, "utf-8"), corrupt);
  assert.equal(run(["current"]).stdout.includes("No active profile"), true);
});

test("reset --dry-run uses 'would' phrasing and writes nothing", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);
  run(["use", "docs"]);
  assert.ok(existsSync(join(claudeDir, "skills-disabled", "docx")), "docx disabled by use");
  const baselineFile = join(claudeDir, "profiles", ".baseline.json");
  assert.ok(existsSync(baselineFile), "baseline captured by use");

  const res = run(["reset", "--dry-run"]);
  assert.match(res.stdout, /[Ww]ould/);
  assert.doesNotMatch(res.stdout, /Restart Claude Code/);

  // Nothing was restored and the baseline file is still present.
  assert.ok(existsSync(join(claudeDir, "skills-disabled", "docx")), "docx still disabled (dry-run)");
  assert.ok(existsSync(baselineFile), "baseline untouched by dry-run");
  assert.match(run(["current"]).stdout, /Active profile: docs/);
});

test("switching profiles reverts the previous profile's plugin and MCP toggles", () => {
  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify({
      enabledPlugins: { "plugX@m": true, "plugY@m": true },
      enabledMcpjsonServers: ["srv1"],
    }, null, 2)
  );
  run(["create", "a"]);
  run(["add", "a", "skill", "pdf"]);
  run(["add", "a", "plugin", "plugX@m", "--disable"]);
  run(["add", "a", "mcp", "srv1", "--disable"]);
  run(["add", "a", "plugin", "introduced@m"]); // key that did not exist at baseline
  run(["create", "b"]);
  run(["add", "b", "skill", "docx"]);

  run(["use", "a"]);
  let s = readSettings();
  assert.equal(s.enabledPlugins["plugX@m"], false, "a disables plugX");
  assert.equal(s.enabledPlugins["introduced@m"], true, "a introduces a new key");
  assert.deepEqual(s.disabledMcpjsonServers, ["srv1"], "a disables srv1");

  run(["use", "b"]); // b says nothing about plugins or MCP
  s = readSettings();
  assert.equal(s.enabledPlugins["plugX@m"], true, "switching to b reverts a's toggle to baseline");
  assert.equal("introduced@m" in s.enabledPlugins, false, "a's introduced key is removed");
  assert.deepEqual(s.enabledMcpjsonServers, ["srv1"], "srv1 back to enabled under b");
  assert.equal(s.disabledMcpjsonServers, undefined, "no leftover disabled list");
});

test("reset leaves items and plugins that appeared after activation untouched", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);
  run(["use", "docs"]);

  // While the profile is active, the user installs a new skill and a new plugin.
  makeSkill(join(claudeDir, "skills"), "newskill", { description: "installed later" });
  const s = readSettings();
  s.enabledPlugins["brand-new@m"] = true;
  writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(s, null, 2));

  run(["reset"]);

  assert.ok(existsSync(join(claudeDir, "skills", "newskill")), "new skill stays active after reset");
  assert.ok(!existsSync(join(claudeDir, "skills-disabled", "newskill")), "new skill not disabled");
  assert.equal(readSettings().enabledPlugins["brand-new@m"], true, "unknown plugin key untouched");
  assert.equal(readSettings().enabledPlugins["frontend-design@x"], true, "baseline value restored");
});

test("an empty skills list (schema v2) disables everything except the companion", () => {
  run(["import", "-"], { input: '{"name":"barebones","version":2,"skills":[]}' });
  run(["use", "barebones"]);
  assert.ok(existsSync(join(claudeDir, "skills", "ccprofile")), "protected companion stays");
  for (const s of ["pdf", "docx", "playwright"]) {
    assert.ok(existsSync(join(claudeDir, "skills-disabled", s)), `${s} disabled by []`);
  }
});

test("legacy profiles (no version) treat empty lists as untouched", () => {
  mkdirSync(join(claudeDir, "profiles"), { recursive: true });
  writeFileSync(
    join(claudeDir, "profiles", "legacy.json"),
    JSON.stringify({ name: "legacy", skills: [], plugins: {}, mcpServers: {} }, null, 2)
  );
  run(["use", "legacy"]);
  for (const s of ["pdf", "docx", "playwright"]) {
    assert.ok(existsSync(join(claudeDir, "skills", s)), `${s} untouched by legacy []`);
  }
});

test("a live lock blocks activation; a stale lock is reclaimed", () => {
  run(["create", "docs"]);
  run(["add", "docs", "skill", "pdf"]);
  mkdirSync(join(claudeDir, "profiles"), { recursive: true });
  const lockFile = join(claudeDir, "profiles", ".lock");

  // Live lock: this test process's own PID is definitely alive.
  writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const blocked = run(["use", "docs"], { allowFail: true });
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /appears to be mid-activation/);
  assert.ok(!existsSync(join(claudeDir, "skills-disabled", "docx")), "nothing moved while locked");

  // Stale lock: dead PID is reclaimed and the activation proceeds.
  writeFileSync(lockFile, JSON.stringify({ pid: 99999999, at: new Date().toISOString() }));
  run(["use", "docs"]);
  assert.ok(existsSync(join(claudeDir, "skills-disabled", "docx")), "stale lock reclaimed");
  assert.ok(!existsSync(lockFile), "lock released after the run");
});

test("auto re-syncs drift even when the marker says the profile is active", () => {
  run(["create", "work"]);
  run(["add", "work", "skill", "pdf"]);
  const repo = join(HOME, "myrepo");
  mkdirSync(repo, { recursive: true });
  run(["bind", "work", repo]);
  run(["auto"], { cwd: repo });
  assert.ok(existsSync(join(claudeDir, "skills-disabled", "docx")));

  // Drift: someone manually re-enables docx while the marker still says "work".
  renameSync(join(claudeDir, "skills-disabled", "docx"), join(claudeDir, "skills", "docx"));

  const res = run(["auto"], { cwd: repo });
  assert.match(res.stdout, /Skill disabled: docx/, "auto reconciled the drift");
  assert.ok(existsSync(join(claudeDir, "skills-disabled", "docx")), "docx re-disabled");

  // In-sync invocation still reports already active.
  assert.match(run(["auto"], { cwd: repo }).stdout, /already active/);
});

test("control characters from imported profiles are stripped from output", () => {
  const evil = JSON.stringify({ name: "evil", description: "\u001b[31mred\u0007bell" });
  run(["import", "-"], { input: evil });
  run(["use", "evil"]);
  const cur = run(["current"]).stdout;
  assert.ok(!cur.includes("\u001b"), "no ESC byte in output");
  assert.ok(!cur.includes("\u0007"), "no BEL byte in output");
  assert.match(cur, /redbell/, "printable content preserved");
});

test("flags on the wrong command are rejected", () => {
  run(["create", "docs"]);
  const res = run(["list", "--force"], { allowFail: true });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /not supported by "ccprofile list"/);

  const res2 = run(["use", "docs", "--enable"], { allowFail: true });
  assert.equal(res2.code, 1);
  assert.match(res2.stderr, /not supported by "ccprofile use"/);
});

test("import strips unknown fields", () => {
  const input = JSON.stringify({ name: "clean", skills: ["pdf"], sneaky: { huge: "payload" } });
  run(["import", "-"], { input });
  const show = JSON.parse(run(["show", "clean", "--json"]).stdout);
  assert.equal(show.sneaky, undefined, "unknown field not persisted");
  assert.deepEqual(show.skills, ["pdf"]);
});

test("add warns when the item is not installed but keeps it", () => {
  run(["create", "docs"]);
  const res = run(["add", "docs", "skill", "pfd"]); // typo for pdf
  assert.match(res.stdout, /no skill named "pfd" is currently installed/);
  const show = JSON.parse(run(["show", "docs", "--json"]).stdout);
  assert.deepEqual(show.skills, ["pfd"], "item kept for forward-compat");
});

test("mutating commands support --json", () => {
  const created = JSON.parse(run(["create", "docs", "Doc work", "--json"]).stdout);
  assert.equal(created.ok, true);
  assert.equal(created.created, "docs");
  const added = JSON.parse(run(["add", "docs", "skill", "pdf", "--json"]).stdout);
  assert.equal(added.ok, true);
  const deleted = JSON.parse(run(["delete", "docs", "--json"]).stdout);
  assert.equal(deleted.ok, true);
});

test("doctor reports a healthy setup and fails on corrupt settings", () => {
  run(["create", "docs"]);
  const healthy = run(["doctor"]);
  assert.match(healthy.stdout, /\[ok\]/);
  assert.doesNotMatch(healthy.stdout, /\[FAIL\]/);

  writeFileSync(join(claudeDir, "settings.json"), "{ not json ]");
  const sick = run(["doctor"], { allowFail: true });
  assert.equal(sick.code, 1);
  assert.match(sick.stdout, /\[FAIL\]/);
  assert.match(sick.stdout, /invalid JSON/i);
});

test("doctor flags active/disabled collisions and dangling bindings", () => {
  run(["create", "docs"]);
  run(["bind", "docs", join(HOME, "nonexistent-dir")]);
  // Create a collision: pdf present in both dirs.
  makeSkill(join(claudeDir, "skills-disabled"), "pdf", { description: "duplicate copy" });
  const res = run(["doctor"]);
  assert.match(res.stdout, /BOTH/, "collision reported");
  assert.match(res.stdout, /directory that does not exist/, "dangling binding reported");
});

test("multi-line block-scalar descriptions are counted in token estimates", () => {
  const skillDir = join(claudeDir, "skills", "verbose");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), [
    "---",
    "name: verbose",
    "description: >",
    "  This is a long folded description that spans",
    "  several lines and used to be silently dropped",
    "  by the single-line frontmatter parser entirely.",
    "---",
    "Body.",
  ].join("\n"));
  const stats = JSON.parse(run(["stats", "--json"]).stdout);
  const verbose = stats.items.find((s) => s.name === "verbose");
  assert.ok(verbose.idleTokens > 20, `block scalar counted (got ${verbose.idleTokens})`);
  assert.match(verbose.description, /folded description/);
});
