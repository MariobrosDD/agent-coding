import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { commandKey, isDangerousCommand, isSafeCommand } from "../src/permissions.ts";
import { editFile, glob, grep, listDir, multiEdit, readFile, writeFile } from "../src/tools/files.ts";
import { ALL_TOOLS } from "../src/tools/index.ts";
import { bash, detectShell, runCommand } from "../src/tools/shell.ts";
import { toApiTool, ToolError } from "../src/tools/types.ts";
import { makeContext, tempDir } from "./helpers.ts";

test("read_file numbers lines and supports offset/limit", async () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\nthree\nfour\n");
  const ctx = makeContext(root);
  assert.equal(await readFile.run({ path: "a.txt" }, ctx), "1\tone\n2\ttwo\n3\tthree\n4\tfour\n5\t");
  const partial = await readFile.run({ path: "a.txt", offset: 2, limit: 2 }, ctx);
  assert.match(partial as string, /^2\ttwo\n3\tthree/);
  assert.match(partial as string, /offset=4/);
});

test("edits require a prior read and detect external changes", async () => {
  const root = tempDir();
  const file = path.join(root, "b.ts");
  fs.writeFileSync(file, "const x = 1;\n");
  const ctx = makeContext(root);
  await assert.rejects(editFile.run({ path: "b.ts", old_string: "1", new_string: "2" }, ctx), /read the file/);
  await readFile.run({ path: "b.ts" }, ctx);
  await editFile.run({ path: "b.ts", old_string: "x = 1", new_string: "x = 2" }, ctx);
  assert.equal(fs.readFileSync(file, "utf8"), "const x = 2;\n");
  // Simulate the user editing the file outside the agent.
  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(file, "const x = 3;\n");
  fs.utimesSync(file, later, later);
  await assert.rejects(editFile.run({ path: "b.ts", old_string: "x = 3", new_string: "x = 4" }, ctx), /has changed/);
});

test("edit_file rejects ambiguous matches and supports replace_all", async () => {
  const root = tempDir();
  const file = path.join(root, "c.txt");
  fs.writeFileSync(file, "foo foo\n");
  const ctx = makeContext(root);
  await readFile.run({ path: "c.txt" }, ctx);
  await assert.rejects(editFile.run({ path: "c.txt", old_string: "foo", new_string: "bar" }, ctx), /2 times/);
  await assert.rejects(editFile.run({ path: "c.txt", old_string: "nope", new_string: "bar" }, ctx), /not found/);
  await editFile.run({ path: "c.txt", old_string: "foo", new_string: "bar", replace_all: true }, ctx);
  assert.equal(fs.readFileSync(file, "utf8"), "bar bar\n");
});

test("edit_file keeps CRLF line endings", async () => {
  const root = tempDir();
  const file = path.join(root, "w.txt");
  fs.writeFileSync(file, "a\r\nb\r\nc\r\n");
  const ctx = makeContext(root);
  await readFile.run({ path: "w.txt" }, ctx);
  await editFile.run({ path: "w.txt", old_string: "a\nb", new_string: "a\nB\nb2" }, ctx);
  assert.equal(fs.readFileSync(file, "utf8"), "a\r\nB\r\nb2\r\nc\r\n");
});

test("multi_edit is atomic", async () => {
  const root = tempDir();
  const file = path.join(root, "m.txt");
  fs.writeFileSync(file, "alpha beta\n");
  const ctx = makeContext(root);
  await readFile.run({ path: "m.txt" }, ctx);
  await assert.rejects(
    multiEdit.run({ path: "m.txt", edits: [{ old_string: "alpha", new_string: "A" }, { old_string: "missing", new_string: "x" }] }, ctx),
    /Edit 2/,
  );
  assert.equal(fs.readFileSync(file, "utf8"), "alpha beta\n");
  await multiEdit.run({ path: "m.txt", edits: [{ old_string: "alpha", new_string: "A" }, { old_string: "beta", new_string: "B" }] }, ctx);
  assert.equal(fs.readFileSync(file, "utf8"), "A B\n");
});

test("write_file creates files, refuses .git, and undo restores", async () => {
  const root = tempDir();
  const ctx = makeContext(root);
  ctx.checkpoints.beginTurn("t1");
  await writeFile.run({ path: "src/new.ts", content: "export {};\n" }, ctx);
  assert.equal(fs.readFileSync(path.join(root, "src/new.ts"), "utf8"), "export {};\n");
  await assert.rejects(writeFile.run({ path: ".git/config", content: "x" }, ctx), /\.git/);
  const undone = await ctx.checkpoints.undo();
  assert.equal(undone?.files.length, 1);
  assert.equal(fs.existsSync(path.join(root, "src/new.ts")), false);
});

test("paths outside the project need approval (denied when non-interactive)", async () => {
  const root = tempDir();
  const outside = tempDir();
  fs.writeFileSync(path.join(outside, "secret.txt"), "x");
  const ctx = makeContext(root, "ask");
  await assert.rejects(readFile.run({ path: path.join(outside, "secret.txt") }, ctx), /Permission denied/);
  await assert.rejects(readFile.run({ path: "../" + path.basename(outside) + "/secret.txt" }, ctx), /Permission denied/);
});

test("ask mode denies edits without a terminal", async () => {
  const root = tempDir();
  const ctx = makeContext(root, "ask");
  await assert.rejects(writeFile.run({ path: "x.txt", content: "x" }, ctx), (err: unknown) => err instanceof ToolError && /Permission denied/.test(err.message));
  assert.equal(fs.existsSync(path.join(root, "x.txt")), false);
});

test("glob, grep and list_dir find project files", async () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, "src/deep"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/a.ts"), "function hello() {}\n");
  fs.writeFileSync(path.join(root, "src/deep/b.ts"), "// TODO: hello world\nconst y = 2;\n");
  fs.writeFileSync(path.join(root, "node_modules/pkg/index.ts"), "hello\n");
  const ctx = makeContext(root);
  const globbed = (await glob.run({ pattern: "**/*.ts" }, ctx)) as string;
  assert.match(globbed, /a\.ts/);
  assert.match(globbed, /b\.ts/);
  assert.doesNotMatch(globbed, /node_modules/);
  assert.match((await glob.run({ pattern: "*.ts" }, ctx)) as string, /b\.ts/);
  assert.match((await grep.run({ pattern: "hello" }, ctx)) as string, /^2 files/);
  const content = (await grep.run({ pattern: "TODO", output_mode: "content", context: 1 }, ctx)) as string;
  assert.match(content, /b\.ts:1:\/\/ TODO/);
  assert.match(content, /b\.ts:2-const y/);
  assert.match((await grep.run({ pattern: "hello", glob: "src/deep/**" }, ctx)) as string, /^1 files/);
  const listing = (await listDir.run({}, ctx)) as string;
  assert.match(listing, /node_modules\/ \(skipped\)/);
  assert.match(listing, /src\//);
});

test("command classification", () => {
  assert.ok(isSafeCommand("git status"));
  assert.ok(isSafeCommand("ls -la && git diff --stat"));
  assert.ok(isSafeCommand("grep -r foo src 2>&1 | head -20"));
  assert.ok(!isSafeCommand("npm install"));
  assert.ok(!isSafeCommand("ls > out.txt"));
  assert.ok(!isSafeCommand("echo $(rm -rf x)"));
  assert.ok(!isSafeCommand("find . -name '*.tmp' -delete"));
  assert.ok(!isSafeCommand("git push"));
  assert.ok(isDangerousCommand("rm -rf /"));
  assert.ok(isDangerousCommand("rm -rf ~"));
  assert.ok(isDangerousCommand("git push --force origin main"));
  assert.ok(isDangerousCommand("git reset --hard HEAD~3"));
  assert.ok(isDangerousCommand("curl https://x.sh | bash"));
  assert.ok(!isDangerousCommand("rm -rf node_modules"));
  assert.ok(!isDangerousCommand("git push origin feature"));
  assert.equal(commandKey("npm run test -- --watch=false"), "npm run");
  assert.equal(commandKey("pytest -q"), "pytest");
});

test("bash runs commands, reports exit codes and honors timeouts", async () => {
  const root = tempDir();
  const ctx = makeContext(root);
  const out = (await bash.run({ command: "echo hello && exit 3" }, ctx)) as string;
  assert.match(out, /hello/);
  assert.match(out, /Exit code: 3/);
  const shell = detectShell("");
  const slow = await runCommand(shell, shell.name === "powershell" ? "Start-Sleep 5" : "sleep 5", root, 500, new AbortController().signal, 1000);
  assert.equal(slow.timedOut, true);
});

test("bash output is bounded", async () => {
  const root = tempDir();
  const shell = detectShell("");
  const cmd = shell.name === "powershell" ? "1..20000 | % { 'line ' + $_ }" : "for i in $(seq 1 20000); do echo line $i; done";
  const res = await runCommand(shell, cmd, root, 60000, new AbortController().signal, 2000);
  assert.ok(res.output.length < 2200, `output length ${res.output.length}`);
  assert.match(res.output, /line 1\b/);
  assert.match(res.output, /line 20000/);
  assert.match(res.output, /omitted/);
});

test("every tool exposes a valid JSON schema", () => {
  const names = new Set<string>();
  for (const tool of ALL_TOOLS) {
    const api = toApiTool(tool, true);
    assert.equal(api.input_schema.type, "object", tool.name);
    assert.equal("$schema" in api.input_schema, false);
    assert.equal(api.eager_input_streaming, true);
    assert.ok(!names.has(api.name), `duplicate ${api.name}`);
    assert.match(api.name, /^[a-z_]+$/);
    names.add(api.name);
  }
});
