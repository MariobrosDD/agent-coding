import Anthropic from "@anthropic-ai/sdk";
import type { Checkpoints } from "./checkpoints.ts";
import type { Config, Effort } from "./config.ts";
import type { Permissions } from "./permissions.ts";
import type { CostTracker } from "./pricing.ts";
import { detectShell, runCommand } from "./tools/shell.ts";
import { toApiTool, ToolError, type TodoItem, type Tool, type ToolContext, type ToolResultContent } from "./tools/types.ts";
import { c, oneLine, truncateMiddle, type UI } from "./ui.ts";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Message = Anthropic.Beta.BetaMessage;
type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
type ToolResultBlock = Anthropic.Beta.BetaToolResultBlockParam;

/** Models that accept `fallbacks: "default"` on the Claude API. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const INTERRUPTED = "Interrupted by the user before it completed.";

export interface AgentOptions {
  client: Anthropic;
  config: Config;
  ui: UI;
  root: string;
  tools: Tool[];
  systemPrompt: string;
  permissions: Permissions;
  checkpoints: Checkpoints;
  cost: CostTracker;
  /** Subagents print only a compact log of their tool calls. */
  quiet?: boolean;
  label?: string;
  effort?: Effort;
  /** Builds a subagent for the `task` tool. */
  spawnSubagent?: (description: string) => Agent;
  onTurnEnd?: (agent: Agent) => void;
}

export class Agent {
  messages: MessageParam[] = [];
  todos: TodoItem[] = [];
  readonly fileState = new Map<string, number>();
  private controller: AbortController | null = null;
  private readonly o: AgentOptions;
  private readonly toolsByName: Map<string, Tool>;

  constructor(options: AgentOptions) {
    this.o = options;
    this.toolsByName = new Map(options.tools.map((t) => [t.name, t]));
  }

  get busy(): boolean {
    return this.controller !== null;
  }

  /** Aborts the current turn. Returns true if a turn was running. */
  interrupt(): boolean {
    if (!this.controller || this.controller.signal.aborted) return false;
    this.controller.abort();
    return true;
  }

  private log(text: string): void {
    if (this.o.quiet) this.o.ui.line(c.dim(`    ↳ [${this.o.label}] `) + text);
    else this.o.ui.line(text);
  }

  private buildTools(): Anthropic.Beta.BetaToolUnion[] {
    const tools: Anthropic.Beta.BetaToolUnion[] = this.o.tools.map((t) => toApiTool(t, true));
    if (this.o.config.web) {
      tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 8 });
      tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 });
    }
    return tools;
  }

  private buildParams(maxTokens: number): Anthropic.Beta.MessageCreateParamsStreaming {
    const { config } = this.o;
    const betas: Anthropic.Beta.AnthropicBeta[] = [];
    const extra: Partial<Anthropic.Beta.MessageCreateParamsStreaming> = {};
    if (config.compaction) {
      betas.push("compact-2026-01-12");
      extra.context_management = { edits: [{ type: "compact_20260112" }] };
    }
    if (config.fallbacks && FALLBACK_MODELS.has(config.model)) {
      betas.push("server-side-fallback-2026-07-01");
      extra.fallbacks = "default";
    }
    return {
      model: config.model,
      max_tokens: maxTokens,
      stream: true,
      // Stable prefix first (tools -> system), so the whole conversation stays cached.
      system: [{ type: "text", text: this.o.systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: this.buildTools(),
      messages: this.messages,
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: this.o.effort ?? config.effort },
      ...(betas.length ? { betas } : {}),
      ...extra,
    };
  }

  /** Streams one model response to the terminal. Returns null if interrupted. */
  private async callModel(signal: AbortSignal, maxTokens: number): Promise<Message | null> {
    const { ui } = this.o;
    for (let jsonRetries = 0; ; jsonRetries++) {
      if (!this.o.quiet) ui.startSpinner("thinking");
      const stream = this.o.client.beta.messages.stream(this.buildParams(maxTokens), { signal });
      let inThinking = false;
      try {
        for await (const event of stream) {
          if (this.o.quiet) continue;
          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block.type === "thinking") {
              ui.stopSpinner();
              ui.ensureNewline();
              ui.write(c.dim("✻ "));
              inThinking = true;
            } else if (block.type === "text") {
              ui.stopSpinner();
              ui.ensureNewline();
            } else if (block.type === "tool_use") {
              ui.ensureNewline();
              ui.startSpinner(`preparing ${block.name}`);
            } else if (block.type === "compaction") {
              ui.line(c.dim("  (compacting the conversation context…)"));
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") ui.write(event.delta.text);
            else if (event.delta.type === "thinking_delta") ui.write(c.dim(event.delta.thinking));
          } else if (event.type === "content_block_stop" && inThinking) {
            ui.write("\n");
            inThinking = false;
          }
        }
        const message = await stream.finalMessage();
        ui.stopSpinner();
        ui.ensureNewline();
        return message;
      } catch (err) {
        ui.stopSpinner();
        ui.ensureNewline();
        if (signal.aborted || err instanceof Anthropic.APIUserAbortError) return null;
        if (err instanceof Anthropic.APIError || jsonRetries >= 2) throw err;
        // With eager input streaming a malformed tool input surfaces here; the turn was not appended, so re-issue it.
        this.log(c.yellow("  (malformed tool input; retrying the turn)"));
      }
    }
  }

  private reportServerBlocks(message: Message): void {
    for (const block of message.content) {
      const type = (block as { type: string }).type;
      if (block.type === "server_tool_use") {
        const input = block.input as { query?: string; url?: string };
        this.log(c.blue(`● ${block.name}`) + c.dim(`(${oneLine(input.query ?? input.url ?? "", 100)})`));
      } else if (type === "fallback") {
        const fb = block as unknown as { from?: { model?: string }; to?: { model?: string } };
        this.log(c.yellow(`  (${fb.from?.model} declined the request; ${fb.to?.model} continued)`));
      }
    }
  }

  private toolContext(signal: AbortSignal): ToolContext {
    const { o } = this;
    return {
      root: o.root,
      config: o.config,
      ui: o.ui,
      permissions: o.permissions,
      checkpoints: o.checkpoints,
      fileState: this.fileState,
      todos: this.todos,
      signal,
      runSubagent: o.spawnSubagent
        ? async (description, prompt, sig) => {
            const sub = o.spawnSubagent!(description);
            this.o.ui.line(c.magenta(`  ⇢ subagent: ${description}`));
            const result = await sub.run(prompt, sig);
            this.o.ui.line(c.magenta(`  ⇠ subagent finished: ${description}`));
            return result.text || "(the subagent returned no text)";
          }
        : undefined,
    };
  }

  private async runOneTool(block: ToolUseBlock, ctx: ToolContext): Promise<ToolResultBlock> {
    const error = (content: string): ToolResultBlock => ({ type: "tool_result", tool_use_id: block.id, is_error: true, content });
    if (ctx.signal.aborted) return error(INTERRUPTED);
    const tool = this.toolsByName.get(block.name);
    if (!tool) return error(`Unknown tool: ${block.name}`);
    // Inputs are streamed eagerly, so the API did not validate them: validate here before running anything.
    const parsed = tool.schema.safeParse(block.input);
    if (!parsed.success) {
      return error(`Invalid input for ${block.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}. Input received: ${truncateMiddle(JSON.stringify(block.input), 2000)}`);
    }
    try {
      let content: string | ToolResultContent = await tool.run(parsed.data, ctx);
      if (typeof content === "string") content = truncateMiddle(content, this.o.config.maxToolOutputChars);
      return { type: "tool_result", tool_use_id: block.id, content };
    } catch (err) {
      if (ctx.signal.aborted) return error(INTERRUPTED);
      const msg = err instanceof ToolError ? err.message : `Unexpected error: ${(err as Error).message ?? String(err)}`;
      if (!this.o.quiet) this.o.ui.line(c.red(`  ✗ ${oneLine(msg, 200)}`));
      return error(msg);
    }
  }

  /** Runs tool calls in order; consecutive read-only calls run in parallel. Never throws. */
  private async runTools(blocks: ToolUseBlock[], signal: AbortSignal): Promise<ToolResultBlock[]> {
    const ctx = this.toolContext(signal);
    const results: ToolResultBlock[] = [];
    let i = 0;
    while (i < blocks.length) {
      const batch = [blocks[i]];
      const readOnly = (b: ToolUseBlock) => this.toolsByName.get(b.name)?.readOnly ?? false;
      if (readOnly(blocks[i])) while (i + batch.length < blocks.length && readOnly(blocks[i + batch.length])) batch.push(blocks[i + batch.length]);
      for (const b of batch) {
        const tool = this.toolsByName.get(b.name);
        let summary = "";
        try {
          summary = tool ? tool.summarize(b.input as never) : "";
        } catch {
          // input may be malformed; it is reported by runOneTool
        }
        this.log(c.green(`● ${b.name}`) + c.dim(summary ? `(${oneLine(summary, 110)})` : ""));
      }
      results.push(...(await Promise.all(batch.map((b) => this.runOneTool(b, ctx)))));
      i += batch.length;
    }
    return results;
  }

  private async verify(signal: AbortSignal): Promise<{ ok: boolean; output: string }> {
    const { config, ui } = this.o;
    ui.line(c.cyan(`● automatic verification`) + c.dim(`(${config.verify.command})`));
    ui.startSpinner("verifying");
    const res = await runCommand(detectShell(config.shell), config.verify.command, this.o.root, config.verify.timeoutSec * 1000, signal, config.maxToolOutputChars);
    ui.stopSpinner();
    const ok = res.exitCode === 0 && !res.timedOut;
    ui.line(ok ? c.green("  ✔ verification passed") : c.red(`  ✗ verification failed (exit code ${res.exitCode}${res.timedOut ? ", timed out" : ""})`));
    return { ok, output: res.output };
  }

  /**
   * Runs one user turn to completion: model calls, tool calls and (optionally)
   * automatic verification. History is append-only, which keeps the prompt
   * cache and the model's thinking blocks valid.
   */
  async run(userContent: string, parentSignal?: AbortSignal): Promise<{ text: string; interrupted: boolean }> {
    const { config } = this.o;
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    this.controller = controller;
    const signal = controller.signal;
    this.messages.push({ role: "user", content: userContent });
    let text = "";
    let verifyRounds = 0;
    let maxTokens = config.maxTokens;
    try {
      for (let iteration = 0; iteration < config.maxIterations; iteration++) {
        const message = await this.callModel(signal, maxTokens);
        if (!message) {
          this.log(c.yellow("⏹ interrupted"));
          return { text, interrupted: true };
        }
        this.o.cost.add(message.model, message.usage);
        this.reportServerBlocks(message);
        const turnText = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        if (turnText) text = turnText;
        const toolUses = message.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

        if (message.stop_reason === "refusal") {
          // A refusal can cut a tool call off mid-input: never run that turn's tools.
          const details = message.stop_details;
          this.log(c.red(`✗ The model declined the request${details?.category ? ` (category: ${details.category})` : ""}.${details?.explanation ? " " + details.explanation : ""}`));
          return { text, interrupted: false };
        }
        if (message.stop_reason === "model_context_window_exceeded") {
          this.log(c.red("✗ The context window was exceeded. Use /clear to start a new conversation."));
          return { text, interrupted: false };
        }
        if (message.stop_reason === "max_tokens" && toolUses.length) {
          // A truncated tool input can still look valid: retry the turn with more room instead of running it.
          if (maxTokens < 128000) {
            maxTokens = 128000;
            this.log(c.yellow("  (response cut off by length; retrying with more room)"));
            continue;
          }
          this.log(c.red("✗ The response was cut off by length even at the maximum token limit. Ask for the change in smaller parts."));
          return { text, interrupted: false };
        }

        this.messages.push({ role: "assistant", content: message.content });

        if (message.stop_reason === "pause_turn" || message.stop_reason === "compaction") continue;
        if (toolUses.length) {
          const results = await this.runTools(toolUses, signal);
          this.messages.push({ role: "user", content: results });
          if (signal.aborted) {
            this.log(c.yellow("⏹ interrupted"));
            return { text, interrupted: true };
          }
          continue;
        }
        if (message.stop_reason === "max_tokens") this.log(c.yellow("  (the response was cut off by length)"));

        const changed = this.o.checkpoints.changedInCurrentTurn().length > 0;
        if (!this.o.quiet && config.verify.auto && config.verify.command && changed) {
          if (verifyRounds >= config.verify.maxRounds) {
            this.log(c.yellow(`  (verification still failing after ${verifyRounds} attempts; please review the result)`));
          } else {
            const result = await this.verify(signal);
            if (signal.aborted) return { text, interrupted: true };
            if (!result.ok) {
              verifyRounds++;
              this.messages.push({
                role: "user",
                content: `[Automatic verification] The command \`${config.verify.command}\` failed after your changes. Output:\n\n${truncateMiddle(result.output, config.maxToolOutputChars)}\n\nFind the cause and fix it. If the failure is unrelated to your changes, explain that instead of touching unrelated code.`,
              });
              continue;
            }
          }
        }
        return { text, interrupted: false };
      }
      this.log(c.yellow(`  (reached the limit of ${config.maxIterations} steps for this turn; type "continue" to keep going)`));
      return { text, interrupted: false };
    } finally {
      parentSignal?.removeEventListener("abort", onParentAbort);
      this.controller = null;
      this.o.onTurnEnd?.(this);
    }
  }
}

/** Human-readable message for an API failure. */
export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Invalid credentials. Set the ANTHROPIC_API_KEY environment variable to your key from https://console.anthropic.com";
  }
  if (err instanceof Anthropic.PermissionDeniedError) return `Permission denied by the API: ${err.message}`;
  if (err instanceof Anthropic.NotFoundError) return `Not found (does the model exist and do you have access?): ${err.message}`;
  if (err instanceof Anthropic.RateLimitError) return "API rate limit reached after several retries. Wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Request rejected by the API: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return `API server error (${err.status}); retries failed. Try again in a moment.`;
  if (err instanceof Anthropic.APIConnectionError) return `Could not connect to the API: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error (${err.status}): ${err.message}`;
  return `Error: ${(err as Error)?.stack ?? String(err)}`;
}
