import { fileTools } from "./files.ts";
import { gitTools } from "./git.ts";
import { loadGuide } from "./guides.ts";
import { interactionTools } from "./interaction.ts";
import { metaTools } from "./meta.ts";
import { bash, jobKill, jobOutput } from "./shell.ts";
import type { Tool } from "./types.ts";

// Order is fixed so the tool list (part of the cached prompt prefix) never changes.
export const ALL_TOOLS: Tool[] = [
  ...fileTools,
  bash,
  jobOutput,
  jobKill,
  ...gitTools,
  loadGuide,
  ...metaTools,
  ...interactionTools,
] as unknown as Tool[];

const NOT_FOR_SUBAGENTS = new Set(["task", "todo_write", "job_output"]);

/** Tools available to read-only subagents. */
export const SUBAGENT_TOOLS: Tool[] = ALL_TOOLS.filter((t) => t.readOnly && !NOT_FOR_SUBAGENTS.has(t.name));
