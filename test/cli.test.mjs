import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
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

test("snapshot omits kinds with no active items", () => {
  rmSync(join(claudeDir, "agents"), { recursive: true, force: true });
  run(["snapshot", "snap"]);
  const show = JSON.parse(run(["show", "snap", "--json"]).stdout);
  assert.equal(show.agents, undefined, "empty kind omitted instead of recorded as []");
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
