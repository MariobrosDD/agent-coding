import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Checkpoints } from "../src/checkpoints.ts";
import { DEFAULT_CONFIG, type Config, type PermissionMode } from "../src/config.ts";
import { Permissions } from "../src/permissions.ts";
import type { ToolContext } from "../src/tools/types.ts";
import { UI } from "../src/ui.ts";

export function tempDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "coding-agent-test-")));
}

export function testConfig(over: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, verify: { ...DEFAULT_CONFIG.verify }, ...over };
}

export function makeContext(root: string, mode: PermissionMode = "yolo"): ToolContext {
  const ui = new UI(false);
  return {
    root,
    config: testConfig(),
    ui,
    permissions: new Permissions(mode, ui, []),
    checkpoints: new Checkpoints(),
    fileState: new Map(),
    todos: [],
    signal: new AbortController().signal,
  };
}
