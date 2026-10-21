import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Permissions } from "../permissions.ts";
import type { Checkpoints } from "../checkpoints.ts";
import type { UI } from "../ui.ts";

export type ToolResultContent = Exclude<Anthropic.Beta.BetaToolResultBlockParam["content"], undefined>;

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface ToolContext {
  root: string;
  config: Config;
  ui: UI;
  permissions: Permissions;
  checkpoints: Checkpoints;
  /** mtime (ms) of each file at the moment the agent last read or wrote it. */
  fileState: Map<string, number>;
  todos: TodoItem[];
  signal: AbortSignal;
  /** Runs a read-only subagent; absent inside subagents (no nesting). */
  runSubagent?: (description: string, prompt: string, signal: AbortSignal) => Promise<string>;
}

export interface Tool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  schema: S;
  /** Read-only tools never change anything and may run in parallel. */
  readOnly: boolean;
  /** Short human summary of a call, shown in the transcript. */
  summarize(input: z.infer<S>): string;
  run(input: z.infer<S>, ctx: ToolContext): Promise<string | ToolResultContent>;
}

export function defineTool<S extends z.ZodObject>(tool: Tool<S>): Tool<S> {
  return tool;
}

/** Thrown by tools to report a failure back to the model as an error result. */
export class ToolError extends Error {}

export function toApiTool(tool: Tool, eagerStreaming: boolean): Anthropic.Beta.BetaTool {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(tool.schema) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
    ...(eagerStreaming ? { eager_input_streaming: true } : {}),
  };
}
