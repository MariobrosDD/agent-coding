import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { commandKey, isDangerousCommand, isSafeCommand } from "../permissions.ts";
import { c, oneLine, truncateMiddle } from "../ui.ts";
import { defineTool, ToolError } from "./types.ts";

export interface ShellInfo {
  file: string;
  args: (command: string) => string[];
  name: string;
}

/** Bash where available (Git Bash on Windows), otherwise PowerShell. */
export function detectShell(override: string): ShellInfo {
  const bash = (file: string): ShellInfo => ({ file, args: (cmd) => ["-c", cmd], name: "bash" });
  if (override) {
    const base = path.basename(override).toLowerCase();
    if (base.startsWith("pwsh") || base.startsWith("powershell")) {
      return { file: override, args: (cmd) => ["-NoProfile", "-NonInteractive", "-Command", cmd], name: "powershell" };
    }
    if (base.startsWith("cmd")) return { file: override, args: (cmd) => ["/d", "/s", "/c", cmd], name: "cmd" };
    return bash(override);
  }
  if (process.platform !== "win32") return bash(fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh");
  const candidates = [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "bin", "bash.exe"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) return bash(found);
  return { file: "powershell.exe", args: (cmd) => ["-NoProfile", "-NonInteractive", "-Command", cmd], name: "powershell" };
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

export interface RunResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
}

export function runCommand(shell: ShellInfo, command: string, cwd: string, timeoutMs: number, signal: AbortSignal, maxChars: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(shell.file, shell.args(command), {
      cwd,
      env: { ...process.env, CI: process.env.CI ?? "1", GIT_PAGER: "cat", PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    // Keep the head and a rolling tail so huge outputs stay bounded.
    const headMax = Math.floor(maxChars * 0.4);
    const tailMax = maxChars - headMax;
    let head = "";
    let tail = "";
    let dropped = 0;
    let extra = "";
    const append = (chunk: Buffer) => {
      let text = chunk.toString("utf8");
      if (head.length < headMax) {
        const take = text.slice(0, headMax - head.length);
        head += take;
        text = text.slice(take.length);
      }
      if (!text) return;
      tail += text;
      if (tail.length > tailMax) {
        dropped += tail.length - tailMax;
        tail = tail.slice(-tailMax);
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      if (child.pid) killTree(child.pid);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      const output = (dropped ? `${head}\n\n[... ${dropped} characters omitted ...]\n\n${tail}` : head + tail) + extra;
      resolve({ output, exitCode, timedOut, aborted });
    };
    child.on("error", (err) => {
      extra = `\n${err.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

export const bash = defineTool({
  name: "bash",
  description:
    "Runs a command in the system shell (see the environment section of the prompt) from the project root. " +
    "Use it to build, run tests, linters, git, package managers, etc. Every call starts at the root " +
    "(use `cd dir && cmd` if you need another directory). There is no interactive input: use non-interactive flags (-y, --yes). " +
    "For processes that keep running (dev servers, watchers, long simulations or builds) set run_in_background: true, " +
    "then use job_output to read their output and job_kill to stop them. " +
    "Prefer read_file/grep/glob/edit_file for reading, searching and editing files.",
  schema: z.object({
    command: z.string().describe("Command to run"),
    description: z.string().optional().describe("What the command does, in 5-10 words"),
    timeout_sec: z.number().int().min(1).max(1800).optional().describe("Timeout in seconds (default 120; ignored in the background)"),
    run_in_background: z.boolean().optional().describe("Start the command as a background job and return immediately"),
  }),
  readOnly: false,
  summarize: (i) => oneLine(i.command, 120),
  async run(input, ctx) {
    const shell = detectShell(ctx.config.shell);
    const dangerous = isDangerousCommand(input.command);
    if (dangerous || !isSafeCommand(input.command, ctx.permissions.extraSafeCommands)) {
      const verdict = await ctx.permissions.request({
        kind: "exec",
        key: commandKey(input.command),
        title: `Run command${input.description ? ` (${input.description})` : ""}`,
        detail: c.cyan(`  $ ${input.command}`),
        dangerous,
      });
      if (!verdict.ok) throw new ToolError(verdict.reason);
    }
    if (input.run_in_background) {
      const job = startJob(shell, input.command, ctx.root, ctx.config.maxToolOutputChars * 4);
      // Give fast failures (command not found, port in use) a moment to show up.
      await waitForJob(job, 1500, undefined, ctx.signal);
      ctx.ui.line(c.dim(`  background job ${job.id} (pid ${job.child.pid ?? "?"})`));
      return `Started background job ${job.id}.\n${describeJob(job)}\n\n${readJob(job) || "(no output yet)"}\n\nUse job_output to read more output and job_kill to stop it.`;
    }
    ctx.ui.startSpinner(`running ${oneLine(input.command, 50)}`);
    const result = await runCommand(shell, input.command, ctx.root, (input.timeout_sec ?? 120) * 1000, ctx.signal, ctx.config.maxToolOutputChars);
    ctx.ui.stopSpinner();
    const tail = result.output.trim();
    if (tail) ctx.ui.line(c.dim(tail.split("\n").slice(-6).map((l) => "  │ " + oneLine(l, 150)).join("\n")));
    const status = result.aborted
      ? "Interrupted by the user."
      : result.timedOut
        ? `Timed out after ${input.timeout_sec ?? 120} s; the process was killed.`
        : `Exit code: ${result.exitCode}`;
    if (result.aborted) throw new ToolError(`${status}\n${tail}`);
    return `${tail || "(no output)"}\n\n${status}`;
  },
});

interface Job {
  id: string;
  command: string;
  child: ChildProcess;
  started: number;
  /** Retained output; older text is dropped once it exceeds the cap. */
  buffer: string;
  /** Characters dropped from the start of `buffer` so far. */
  dropped: number;
  /** Absolute offset of the next character the agent has not read. */
  readOffset: number;
  exitCode: number | null;
  done: boolean;
  listeners: Set<() => void>;
}

const jobs = new Map<string, Job>();
let nextJobId = 1;

process.on("exit", () => {
  for (const job of jobs.values()) if (!job.done && job.child.pid) killTree(job.child.pid);
});

function startJob(shell: ShellInfo, command: string, cwd: string, cap: number): Job {
  const child = spawn(shell.file, shell.args(command), {
    cwd,
    env: { ...process.env, GIT_PAGER: "cat", PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const job: Job = { id: `job${nextJobId++}`, command, child, started: Date.now(), buffer: "", dropped: 0, readOffset: 0, exitCode: null, done: false, listeners: new Set() };
  const notify = () => job.listeners.forEach((fn) => fn());
  const append = (chunk: Buffer) => {
    job.buffer += chunk.toString("utf8");
    if (job.buffer.length > cap) {
      const cut = job.buffer.length - cap;
      job.buffer = job.buffer.slice(cut);
      job.dropped += cut;
    }
    notify();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  child.on("error", (err) => {
    job.buffer += `\n${err.message}`;
    job.done = true;
    notify();
  });
  child.on("close", (code) => {
    job.exitCode = code;
    job.done = true;
    notify();
  });
  jobs.set(job.id, job);
  return job;
}

/** Returns output the agent has not read yet and marks it as read. */
function readJob(job: Job): string {
  const start = Math.max(job.readOffset, job.dropped);
  const skipped = start - job.readOffset;
  const text = job.buffer.slice(start - job.dropped);
  job.readOffset = job.dropped + job.buffer.length;
  return (skipped > 0 ? `[... ${skipped} older characters dropped ...]\n` : "") + text.trim();
}

function describeJob(job: Job): string {
  const secs = Math.round((Date.now() - job.started) / 1000);
  return `${job.id}: ${job.done ? `finished (exit code ${job.exitCode})` : `running for ${secs}s`} — ${oneLine(job.command, 100)}`;
}

/**
 * Waits until the job exits, `until` matches its output (including output
 * already read, so a "ready" line printed early still counts), the timeout
 * passes or the turn is interrupted.
 */
function waitForJob(job: Job, timeoutMs: number, until: RegExp | undefined, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (job.done || signal.aborted || (until && until.test(job.buffer))) finish();
    };
    const finish = () => {
      clearTimeout(timer);
      job.listeners.delete(check);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    job.listeners.add(check);
    signal.addEventListener("abort", finish, { once: true });
    check();
  });
}

export const jobOutput = defineTool({
  name: "job_output",
  description:
    "Reads new output from a background job started with bash run_in_background, and its status. Without `id`, lists all jobs. " +
    "`wait_sec` waits for the job to finish (or for `until` to match new output, e.g. `listening on|ready`) before returning.",
  schema: z.object({
    id: z.string().optional().describe("Job id, e.g. job1"),
    wait_sec: z.number().int().min(0).max(1800).optional().describe("Seconds to wait (default 0)"),
    until: z.string().optional().describe("Regular expression that ends the wait when it appears in new output"),
  }),
  readOnly: true,
  summarize: (i) => (i.id ?? "all jobs") + (i.wait_sec ? ` (wait ${i.wait_sec}s)` : ""),
  async run(input, ctx) {
    if (!input.id) return [...jobs.values()].map(describeJob).join("\n") || "No background jobs.";
    const job = jobs.get(input.id);
    if (!job) throw new ToolError(`Unknown job: ${input.id}`);
    let until: RegExp | undefined;
    try {
      until = input.until ? new RegExp(input.until, "i") : undefined;
    } catch (err) {
      throw new ToolError(`Invalid regular expression: ${(err as Error).message}`);
    }
    if (input.wait_sec) await waitForJob(job, input.wait_sec * 1000, until, ctx.signal);
    return `${describeJob(job)}\n\n${truncateMiddle(readJob(job), ctx.config.maxToolOutputChars) || "(no new output)"}`;
  },
});

export const jobKill = defineTool({
  name: "job_kill",
  description: "Stops a background job (and its child processes).",
  schema: z.object({ id: z.string().describe("Job id, e.g. job1") }),
  readOnly: false,
  summarize: (i) => i.id,
  async run(input) {
    const job = jobs.get(input.id);
    if (!job) throw new ToolError(`Unknown job: ${input.id}`);
    if (!job.done && job.child.pid) killTree(job.child.pid);
    return `Stopped ${job.id}.`;
  },
});
