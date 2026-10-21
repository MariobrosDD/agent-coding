import { execFile } from "node:child_process";
import { z } from "zod";
import { c, truncateMiddle } from "../ui.ts";
import { defineTool, ToolError } from "./types.ts";

export function git(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true, signal, env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
      if (err) reject(new ToolError((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return git(["rev-parse", "--is-inside-work-tree"], cwd).then(
    (out) => out.trim() === "true",
    () => false,
  );
}

export const gitStatus = defineTool({
  name: "git_status",
  description: "Shows the current branch and the git repository status (modified, staged and untracked files).",
  schema: z.object({}),
  readOnly: true,
  summarize: () => "",
  async run(_input, ctx) {
    const out = await git(["status", "--short", "--branch"], ctx.root, ctx.signal);
    return out.trim() || "No changes.";
  },
});

export const gitDiff = defineTool({
  name: "git_diff",
  description: "Shows the git diff. Unstaged changes by default; `staged` for staged changes; `ref` to compare against a commit or branch.",
  schema: z.object({
    staged: z.boolean().optional(),
    ref: z.string().optional().describe("Commit, branch or range (e.g. main...HEAD)"),
    path: z.string().optional().describe("Limit to a file or folder"),
    stat: z.boolean().optional().describe("Only a summary of files and lines"),
  }),
  readOnly: true,
  summarize: (i) => [i.staged && "--staged", i.ref, i.path].filter(Boolean).join(" "),
  async run(input, ctx) {
    if (input.ref?.startsWith("-")) throw new ToolError("Invalid ref.");
    const args = ["diff", "--no-color"];
    if (input.staged) args.push("--staged");
    if (input.stat) args.push("--stat");
    if (input.ref) args.push(input.ref);
    if (input.path) args.push("--", input.path);
    const out = await git(args, ctx.root, ctx.signal);
    return truncateMiddle(out.trim(), ctx.config.maxToolOutputChars) || "No differences.";
  },
});

export const gitLog = defineTool({
  name: "git_log",
  description: "Shows recent commit history (useful to match the style of commit messages).",
  schema: z.object({
    count: z.number().int().min(1).max(100).optional().describe("Number of commits (default 15)"),
    path: z.string().optional(),
  }),
  readOnly: true,
  summarize: (i) => i.path ?? "",
  async run(input, ctx) {
    const args = ["log", `-n${input.count ?? 15}`, "--date=short", "--pretty=format:%h %ad %an  %s"];
    if (input.path) args.push("--", input.path);
    return (await git(args, ctx.root, ctx.signal)).trim() || "No commits.";
  },
});

export const gitCommit = defineTool({
  name: "git_commit",
  description:
    "Creates a commit. Commit ONLY when the user has asked for it. Check git_status and git_diff first. " +
    "`files` lists what to stage (git add); if omitted, whatever is already staged is used. Never include secrets (.env, keys).",
  schema: z.object({
    message: z.string().describe("Commit message (short imperative first line; optional body)"),
    files: z.array(z.string()).optional().describe("Files to add before committing; use [\".\"] for everything"),
  }),
  readOnly: false,
  summarize: (i) => i.message.split("\n")[0],
  async run(input, ctx) {
    const preview = input.files?.length ? `  git add ${input.files.join(" ")}\n` : "";
    const verdict = await ctx.permissions.request({
      kind: "exec",
      key: "git commit",
      title: "Create a commit",
      detail: c.cyan(`${preview}  git commit -m ${JSON.stringify(input.message)}`),
    });
    if (!verdict.ok) throw new ToolError(verdict.reason);
    if (input.files?.length) await git(["add", "--", ...input.files], ctx.root, ctx.signal);
    const staged = (await git(["diff", "--staged", "--name-only"], ctx.root, ctx.signal)).trim();
    if (!staged) throw new ToolError("There are no staged changes to commit.");
    const out = await git(["commit", "-m", input.message], ctx.root, ctx.signal);
    return out.trim();
  },
});

export const gitTools = [gitStatus, gitDiff, gitLog, gitCommit];
