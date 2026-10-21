import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { Agent } from "../src/agent.ts";
import { Checkpoints } from "../src/checkpoints.ts";
import { Permissions } from "../src/permissions.ts";
import { CostTracker } from "../src/pricing.ts";
import { ALL_TOOLS } from "../src/tools/index.ts";
import { UI } from "../src/ui.ts";
import { tempDir, testConfig } from "./helpers.ts";

type Block = Record<string, unknown>;
type Step = { content: Block[]; stop_reason: string; stop_details?: unknown } | ((params: Record<string, unknown>) => Promise<never>);

/** A stand-in for the Anthropic client that replays scripted responses. */
function fakeClient(steps: Step[]) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>, opts: { signal?: AbortSignal }) {
          // Snapshot the request the way it would be serialized.
          calls.push(JSON.parse(JSON.stringify(params)));
          const step = steps.shift();
          if (!step) throw new Error("no scripted response left");
          const message = typeof step === "function" ? null : {
            id: `msg_${calls.length}`, type: "message", role: "assistant", model: params.model,
            content: step.content, stop_reason: step.stop_reason, stop_details: step.stop_details ?? null,
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          };
          return {
            async *[Symbol.asyncIterator]() {
              if (typeof step === "function") await step(params);
              for (const [index, block] of message!.content.entries()) {
                if (opts.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
                yield { type: "content_block_start", index, content_block: block };
                if (block.type === "text") yield { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } };
                yield { type: "content_block_stop", index };
              }
            },
            async finalMessage() {
              return message;
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

function makeAgent(root: string, steps: Step[], configOver = {}) {
  const { client, calls } = fakeClient(steps);
  const ui = new UI(false);
  const config = testConfig({ permissionMode: "yolo", ...configOver });
  const checkpoints = new Checkpoints();
  checkpoints.beginTurn("test");
  const agent = new Agent({
    client, config, ui, root, checkpoints,
    permissions: new Permissions("yolo", ui, []),
    cost: new CostTracker(),
    tools: ALL_TOOLS,
    systemPrompt: "test system prompt",
  });
  return { agent, calls };
}

const toolUse = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });
const text = (t: string): Block => ({ type: "text", text: t });

test("runs tools, returns results in order and builds a valid request", async () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "hello.txt"), "hello world\n");
  const { agent, calls } = makeAgent(root, [
    { content: [text("Let me look at the file."), toolUse("t1", "read_file", { path: "hello.txt" }), toolUse("t2", "grep", { pattern: "world" })], stop_reason: "tool_use" },
    { content: [text("The file says hello world.")], stop_reason: "end_turn" },
  ]);
  const result = await agent.run("What does hello.txt say?");
  assert.equal(result.text, "The file says hello world.");
  assert.deepEqual(agent.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  const results = agent.messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.deepEqual(results.map((r) => r.tool_use_id), ["t1", "t2"]);
  assert.match(String(results[0].content), /1\thello world/);
  assert.match(String(results[1].content), /hello\.txt/);
  assert.ok(results.every((r) => !r.is_error));

  const req = calls[0] as Record<string, any>;
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.stream, true);
  assert.deepEqual(req.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(req.output_config, { effort: "max" });
  assert.equal(req.max_tokens, 128000);
  for (const name of ["ask_user", "present_plan", "load_guide", "job_output", "job_kill"]) {
    assert.ok(req.tools.some((t: any) => t.name === name), `tool ${name} is offered`);
  }
  assert.deepEqual(req.cache_control, { type: "ephemeral" });
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["compact-2026-01-12", "server-side-fallback-2026-07-01"]);
  assert.deepEqual(req.context_management, { edits: [{ type: "compact_20260112" }] });
  assert.ok(req.tools.some((t: any) => t.type === "web_search_20260209"));
  assert.ok(req.tools.filter((t: any) => !t.type).every((t: any) => t.eager_input_streaming === true));
  // History is append-only: the second request starts with the first request's messages.
  assert.deepEqual((calls[1] as any).messages.slice(0, 1), calls[0].messages);
});

test("invalid tool input becomes an error result instead of running", async () => {
  const root = tempDir();
  const { agent } = makeAgent(root, [
    { content: [toolUse("t1", "write_file", { path: "x.txt" })], stop_reason: "tool_use" },
    { content: [text("Sorry.")], stop_reason: "end_turn" },
  ]);
  await agent.run("create x.txt");
  const [res] = agent.messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.equal(res.is_error, true);
  assert.match(String(res.content), /content/);
  assert.equal(fs.existsSync(path.join(root, "x.txt")), false);
});

test("truncated tool input is retried with more room and never executed", async () => {
  const root = tempDir();
  const { agent, calls } = makeAgent(root, [
    { content: [toolUse("t1", "write_file", { path: "big.txt", content: "partial" })], stop_reason: "max_tokens" },
    { content: [text("Done.")], stop_reason: "end_turn" },
  ], { maxTokens: 64000 });
  await agent.run("write a big file");
  assert.equal(fs.existsSync(path.join(root, "big.txt")), false);
  assert.equal(calls[1].max_tokens, 128000);
  assert.deepEqual(agent.messages.map((m) => m.role), ["user", "assistant"]);
});

test("refusals stop the turn without running tools", async () => {
  const root = tempDir();
  const { agent } = makeAgent(root, [
    { content: [toolUse("t1", "bash", { command: "echo hi" })], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } },
  ]);
  const result = await agent.run("something");
  assert.equal(result.interrupted, false);
  assert.deepEqual(agent.messages.map((m) => m.role), ["user"]);
});

test("automatic verification feeds failures back until they pass", async () => {
  const root = tempDir();
  const check = `node -e "process.exit(require('fs').existsSync('ok.txt') ? 0 : 1)"`;
  const { agent } = makeAgent(
    root,
    [
      { content: [toolUse("t1", "write_file", { path: "a.txt", content: "a" })], stop_reason: "tool_use" },
      { content: [text("Ready.")], stop_reason: "end_turn" },
      { content: [toolUse("t2", "write_file", { path: "ok.txt", content: "ok" })], stop_reason: "tool_use" },
      { content: [text("Fixed.")], stop_reason: "end_turn" },
    ],
    { verify: { command: check, auto: true, maxRounds: 3, timeoutSec: 60 } },
  );
  const result = await agent.run("make the change");
  assert.equal(result.text, "Fixed.");
  const note = agent.messages.find((m) => typeof m.content === "string" && m.content.startsWith("[Automatic verification]"));
  assert.ok(note, "verification failure was reported to the model");
});

test("interrupting during a tool still answers every tool call", async () => {
  const root = tempDir();
  const { agent } = makeAgent(root, [
    { content: [toolUse("t1", "bash", { command: "sleep 20" }), toolUse("t2", "read_file", { path: "nope" })], stop_reason: "tool_use" },
  ]);
  setTimeout(() => agent.interrupt(), 700);
  const started = Date.now();
  const result = await agent.run("wait");
  assert.equal(result.interrupted, true);
  assert.ok(Date.now() - started < 15000, "the command was killed");
  const results = agent.messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.deepEqual(results.map((r) => r.tool_use_id), ["t1", "t2"]);
  assert.ok(results.every((r) => r.is_error));
});

test("subagents run read-only tools and return their report", async () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "notes.md"), "key: 42\n");
  const ui = new UI(false);
  const config = testConfig({ permissionMode: "yolo" });
  const shared = { config, ui, root, checkpoints: new Checkpoints(), permissions: new Permissions("yolo", ui, []), cost: new CostTracker() };
  const sub = fakeClient([
    { content: [toolUse("s1", "read_file", { path: "notes.md" })], stop_reason: "tool_use" },
    { content: [text("The key is 42 (notes.md:1).")], stop_reason: "end_turn" },
  ]);
  const main = fakeClient([
    { content: [toolUse("t1", "task", { description: "find key", prompt: "Find the key in notes.md" })], stop_reason: "tool_use" },
    { content: [text("The key is 42.")], stop_reason: "end_turn" },
  ]);
  const agent = new Agent({
    ...shared, client: main.client, tools: ALL_TOOLS, systemPrompt: "main",
    spawnSubagent: (label) => new Agent({ ...shared, client: sub.client, tools: ALL_TOOLS.filter((t) => t.readOnly && t.name !== "task"), systemPrompt: "sub", quiet: true, label, effort: "medium" }),
  });
  await agent.run("what is the key?");
  const [res] = agent.messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
  assert.equal(res.content, "The key is 42 (notes.md:1).");
  assert.deepEqual((sub.calls[0] as any).output_config, { effort: "medium" });
  assert.ok(!(sub.calls[0] as any).tools.some((t: any) => t.name === "bash" || t.name === "write_file"));
});
