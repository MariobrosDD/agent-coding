import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PermissionMode = "ask" | "auto-edit" | "yolo" | "plan";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Config {
  model: string;
  effort: Effort;
  /** Effort for subagents spawned with the `task` tool. */
  subagentEffort: Effort;
  maxTokens: number;
  permissionMode: PermissionMode;
  /** Shell executable for the bash tool. Empty = auto-detect. */
  shell: string;
  web: boolean;
  /** Server-side compaction when the context grows (beta). */
  compaction: boolean;
  /** Server-side refusal fallback (beta). */
  fallbacks: boolean;
  /** Maximum characters kept from a single tool result. */
  maxToolOutputChars: number;
  /** Maximum model round trips in a single user turn. */
  maxIterations: number;
  verify: {
    /** Command that checks the project, e.g. "npm test" or "npm run build && npm test". */
    command: string;
    /** Run the command automatically after a turn that changed files. */
    auto: boolean;
    /** How many times the agent may try to fix a failing verification in one turn. */
    maxRounds: number;
    timeoutSec: number;
  };
  /** Bash commands (prefixes) that run without asking, in addition to the built-in read-only list. */
  allowedCommands: string[];
}

export const DEFAULT_CONFIG: Config = {
  model: "claude-opus-5-5",
  effort: "max",
  subagentEffort: "high",
  maxTokens: 128000,
  permissionMode: "ask",
  shell: "",
  web: true,
  compaction: true,
  fallbacks: true,
  maxToolOutputChars: 30000,
  maxIterations: 400,
  verify: { command: "", auto: false, maxRounds: 3, timeoutSec: 600 },
  allowedCommands: [],
};

export const GLOBAL_DIR = path.join(os.homedir(), ".coding-agent");
export const PROJECT_DIR_NAME = ".agent";

export function projectDir(root: string): string {
  return path.join(root, PROJECT_DIR_NAME);
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not read config file ${file}: ${(err as Error).message}`);
  }
}

function merge(base: Config, over: Record<string, unknown>): Config {
  const out: Config = { ...base, verify: { ...base.verify } };
  for (const [key, value] of Object.entries(over)) {
    if (!(key in base)) continue;
    if (key === "verify" && value && typeof value === "object") {
      Object.assign(out.verify, value);
    } else {
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** Global config (~/.coding-agent/config.json) overridden by project config (.agent/config.json). */
export function loadConfig(root: string): Config {
  let config = merge(DEFAULT_CONFIG, readJson(path.join(GLOBAL_DIR, "config.json")));
  config = merge(config, readJson(path.join(projectDir(root), "config.json")));
  if (process.env.CODING_AGENT_MODEL) config.model = process.env.CODING_AGENT_MODEL;
  return config;
}
