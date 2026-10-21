import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { GLOBAL_DIR, projectDir } from "../config.ts";
import { c } from "../ui.ts";
import { defineTool, ToolError, type TodoItem } from "./types.ts";

export function renderTodos(todos: TodoItem[]): string {
  return todos
    .map((t) => (t.status === "completed" ? c.green("  ✔ ") + c.dim(t.content) : t.status === "in_progress" ? c.yellow("  ▶ ") + c.bold(t.content) : c.dim("  ○ ") + t.content))
    .join("\n");
}

export const todoWrite = defineTool({
  name: "todo_write",
  description:
    "Maintains the task list for the current request. Use it as soon as a task has 3 or more steps: create the list, " +
    "mark a step `in_progress` before starting it and `completed` as soon as it is done. Always send the full list. " +
    "Only one task may be `in_progress` at a time.",
  schema: z.object({
    todos: z.array(
      z.object({
        content: z.string(),
        status: z.enum(["pending", "in_progress", "completed"]),
      }),
    ),
  }),
  readOnly: true,
  summarize: (i) => `${i.todos.filter((t) => t.status === "completed").length}/${i.todos.length}`,
  async run(input, ctx) {
    ctx.todos.splice(0, ctx.todos.length, ...input.todos);
    ctx.ui.line(renderTodos(ctx.todos));
    const pending = input.todos.filter((t) => t.status !== "completed").length;
    return pending ? `List updated (${pending} pending).` : "List updated: everything is done.";
  },
});

export function memoryFile(root: string, scope: "project" | "global"): string {
  return scope === "global" ? path.join(GLOBAL_DIR, "memory.md") : path.join(projectDir(root), "memory.md");
}

export const remember = defineTool({
  name: "remember",
  description:
    "Saves a durable fact for future sessions: user preferences, project conventions, build/test commands, " +
    "important decisions. Use it when the user asks you to remember something, or when you discover something non-obvious that will save time later. " +
    "Do not save anything that can be learned by reading the code, and never save secrets. scope `project` (default) or `global` (all folders). " +
    "To delete a memory, use action `forget` with the exact text of the line.",
  schema: z.object({
    fact: z.string().describe("The fact, on one line, concrete and self-contained"),
    scope: z.enum(["project", "global"]).optional(),
    action: z.enum(["add", "forget"]).optional(),
  }),
  readOnly: false,
  summarize: (i) => `${i.action === "forget" ? "forget" : "remember"}: ${i.fact}`,
  async run(input, ctx) {
    const file = memoryFile(ctx.root, input.scope ?? "project");
    const fact = input.fact.replace(/\s+/g, " ").trim();
    if (!fact) throw new ToolError("The fact is empty.");
    const current = await fs.readFile(file, "utf8").catch(() => "");
    const lines = current.split(/\r?\n/).filter(Boolean);
    if (input.action === "forget") {
      const kept = lines.filter((l) => l.replace(/^- /, "") !== fact);
      if (kept.length === lines.length) throw new ToolError("Memory not found (it must match exactly).");
      await fs.writeFile(file, kept.join("\n") + "\n", "utf8");
      return "Memory deleted.";
    }
    if (lines.some((l) => l.replace(/^- /, "") === fact)) return "Already saved.";
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, [...lines, `- ${fact}`].join("\n") + "\n", "utf8");
    ctx.ui.line(c.magenta(`  ✎ remembered (${input.scope ?? "project"}): ${fact}`));
    return "Saved. It will be available in future sessions.";
  },
});

export const task = defineTool({
  name: "task",
  description:
    "Launches a subagent that investigates autonomously and returns a report. It has read-only tools " +
    "(read, search, git, web) and can NOT modify files or run commands. Use it for broad codebase searches, " +
    "analyzing several areas at once, or researching documentation without filling your context. You can launch several in parallel " +
    "in a single turn. The subagent does not see your conversation: give it all the context in `prompt` and say exactly what it must return.",
  schema: z.object({
    description: z.string().describe("Task summary in 3-6 words"),
    prompt: z.string().describe("Complete, self-contained instructions for the subagent"),
  }),
  readOnly: true,
  summarize: (i) => i.description,
  async run(input, ctx) {
    if (!ctx.runSubagent) throw new ToolError("Subagents cannot launch other subagents.");
    return ctx.runSubagent(input.description, input.prompt, ctx.signal);
  },
});

export const metaTools = [todoWrite, remember, task];
