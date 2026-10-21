import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { detectProject } from "../src/environment.ts";
import { PLAN_MODE_DENIAL } from "../src/permissions.ts";
import { buildSystemPrompt } from "../src/prompt.ts";
import { readFile, writeFile } from "../src/tools/files.ts";
import { listGuides, loadGuide } from "../src/tools/guides.ts";
import { askUser, presentPlan } from "../src/tools/interaction.ts";
import { bash, jobKill, jobOutput } from "../src/tools/shell.ts";
import type { ToolResultContent } from "../src/tools/types.ts";
import { makeContext, tempDir, testConfig } from "./helpers.ts";

test("plan mode blocks edits and commands, and restores the previous mode", async () => {
  const root = tempDir();
  const ctx = makeContext(root, "auto-edit");
  ctx.permissions.enterPlanMode();
  await assert.rejects(writeFile.run({ path: "a.txt", content: "x" }, ctx), (err: Error) => err.message === PLAN_MODE_DENIAL);
  await assert.rejects(bash.run({ command: "npm install" }, ctx), (err: Error) => err.message === PLAN_MODE_DENIAL);
  // Read-only commands still run in plan mode.
  assert.match((await bash.run({ command: "echo still-readable" }, ctx)) as string, /still-readable/);
  assert.equal(fs.existsSync(path.join(root, "a.txt")), false);
  assert.equal(ctx.permissions.exitPlanMode(), "auto-edit");
  await writeFile.run({ path: "a.txt", content: "x" }, ctx);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "x");
});

test("ask_user and present_plan degrade gracefully without a terminal", async () => {
  const ctx = makeContext(tempDir());
  assert.match((await askUser.run({ questions: [{ question: "Which database?", options: [{ label: "Postgres" }] }] }, ctx)) as string, /No user is available/);
  ctx.permissions.enterPlanMode();
  assert.match((await presentPlan.run({ plan: "# Plan\n1. Do it" }, ctx)) as string, /plan mode stays on/);
  assert.equal(ctx.permissions.mode, "plan");
});

test("background jobs stream output, wait for patterns and can be killed", async () => {
  const ctx = makeContext(tempDir());
  const started = (await bash.run({ command: "echo booting && sleep 3 && echo SERVER_$((40+2)) && sleep 30", run_in_background: true }, ctx)) as string;
  const id = started.match(/job\d+/)![0];
  assert.match(started, /\nbooting/);
  const t0 = Date.now();
  const ready = (await jobOutput.run({ id, wait_sec: 20, until: "SERVER_42" }, ctx)) as string;
  assert.ok(Date.now() - t0 < 10_000, "the wait ends as soon as the pattern appears");
  assert.match(ready, /\nSERVER_42/);
  assert.match(ready, /running/);
  // A pattern that already appeared still ends the wait immediately.
  const t1 = Date.now();
  await jobOutput.run({ id, wait_sec: 20, until: "booting" }, ctx);
  assert.ok(Date.now() - t1 < 2_000);
  assert.match((await jobOutput.run({}, ctx)) as string, new RegExp(id));
  await jobKill.run({ id }, ctx);
  const after = (await jobOutput.run({ id, wait_sec: 10 }, ctx)) as string;
  assert.match(after, /finished/);

  const quick = (await bash.run({ command: "echo done-fast", run_in_background: true }, ctx)) as string;
  const quickId = quick.match(/job\d+/)![0];
  const final = (await jobOutput.run({ id: quickId, wait_sec: 10 }, ctx)) as string;
  assert.match(final, /finished \(exit code 0\)/);
});

test("expert guides are listed, loadable and overridable per project", async () => {
  const root = tempDir();
  const names = listGuides(root).map((g) => g.name);
  for (const name of ["safety-critical", "scientific-computing", "embedded-systems", "security", "debugging", "testing"]) {
    assert.ok(names.includes(name), `guide ${name} exists`);
  }
  const ctx = makeContext(root);
  const body = (await loadGuide.run({ name: "safety-critical" }, ctx)) as string;
  assert.match(body, /Power of Ten/);
  assert.doesNotMatch(body, /^---/);
  await assert.rejects(loadGuide.run({ name: "nope" }, ctx), /Available:/);

  fs.mkdirSync(path.join(root, ".agent", "guides"), { recursive: true });
  fs.writeFileSync(path.join(root, ".agent", "guides", "house-style.md"), "---\nname: house-style\ndescription: Our conventions\n---\nUse tabs.\n");
  const custom = listGuides(root).find((g) => g.name === "house-style");
  assert.equal(custom?.source, "project");
  assert.equal(await loadGuide.run({ name: "house-style" }, ctx), "Use tabs.");
});

test("project detection suggests a verification command", () => {
  const node = tempDir();
  fs.writeFileSync(path.join(node, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", test: "vitest run", typecheck: "tsc" }, devDependencies: { vitest: "^3.0.0", typescript: "^5.0.0" } }));
  fs.writeFileSync(path.join(node, "pnpm-lock.yaml"), "");
  const info = detectProject(node);
  assert.equal(info.verifyCommand, "pnpm run typecheck && pnpm run lint && pnpm test");
  assert.match(info.facts.join(" "), /pnpm/);
  assert.match(info.facts.join(" "), /vitest/);

  const placeholder = tempDir();
  fs.writeFileSync(path.join(placeholder, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
  assert.equal(detectProject(placeholder).verifyCommand, null);

  const rust = tempDir();
  fs.writeFileSync(path.join(rust, "Cargo.toml"), "[package]\nname = \"x\"\n");
  assert.equal(detectProject(rust).verifyCommand, "cargo build && cargo test");
});

test("read_file returns PDFs as document blocks", async () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "spec.pdf"), "%PDF-1.4\n%fake\n");
  const result = (await readFile.run({ path: "spec.pdf" }, makeContext(root))) as Exclude<ToolResultContent, string>;
  const doc = result.find((b) => b.type === "document");
  assert.ok(doc && doc.type === "document" && doc.source.type === "base64" && doc.source.media_type === "application/pdf");
});

test("the system prompt carries the environment, guides and verification command", () => {
  const root = tempDir();
  const prompt = buildSystemPrompt(
    {
      root,
      shellName: "bash",
      config: testConfig(),
      git: null,
      toolchains: ["node 24.0.0", "gfortran 14.1.0"],
      project: { facts: ["Rust (Cargo)"], verifyCommand: "cargo build && cargo test" },
      guides: listGuides(root),
    },
    false,
  );
  assert.match(prompt, /ask_user/);
  assert.match(prompt, /gfortran 14\.1\.0/);
  assert.match(prompt, /Detected verification command \(unconfirmed[^)]*\): cargo build && cargo test/);
  assert.match(prompt, /- safety-critical: /);
});
