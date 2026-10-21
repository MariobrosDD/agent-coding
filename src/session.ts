import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { projectDir } from "./config.ts";
import type { TodoItem } from "./tools/types.ts";

export interface SessionData {
  version: 1;
  createdAt: string;
  updatedAt: string;
  model: string;
  title: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  todos: TodoItem[];
}

export function sessionsDir(root: string): string {
  return path.join(projectDir(root), "sessions");
}

/** Conversations are saved under .agent/sessions/ so they can be resumed with --continue / --resume. */
export class SessionStore {
  readonly file: string;
  private readonly createdAt = new Date().toISOString();

  constructor(root: string, file?: string) {
    const dir = sessionsDir(root);
    this.file = file ?? path.join(dir, `${this.createdAt.replace(/[:.]/g, "-")}.json`);
    fs.mkdirSync(dir, { recursive: true });
    const ignore = path.join(projectDir(root), ".gitignore");
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "sessions/\n", "utf8");
  }

  save(model: string, messages: Anthropic.Beta.BetaMessageParam[], todos: TodoItem[]): void {
    if (!messages.length) return;
    const first = messages.find((m) => m.role === "user" && typeof m.content === "string");
    const data: SessionData = {
      version: 1,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      model,
      title: typeof first?.content === "string" ? first.content.slice(0, 80) : "",
      messages,
      todos,
    };
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
    fs.renameSync(tmp, this.file);
  }

  static load(file: string): SessionData {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as SessionData;
    if (data.version !== 1 || !Array.isArray(data.messages)) throw new Error(`Unrecognized session format: ${file}`);
    return data;
  }

  static list(root: string): { file: string; updatedAt: string; title: string }[] {
    const dir = sessionsDir(root);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const file = path.join(dir, f);
        try {
          const d = SessionStore.load(file);
          return { file, updatedAt: d.updatedAt, title: d.title };
        } catch {
          return null;
        }
      })
      .filter((s): s is { file: string; updatedAt: string; title: string } => s !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
