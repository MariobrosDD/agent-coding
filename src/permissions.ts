import type { PermissionMode } from "./config.ts";
import { c, type UI } from "./ui.ts";

export type PermissionKind = "edit" | "exec" | "outside";

export interface PermissionRequest {
  kind: PermissionKind;
  /** Key remembered when the user answers "always this session" (tool name or command prefix). */
  key: string;
  title: string;
  detail?: string;
  /** Dangerous actions are always asked, even in yolo mode, and are never remembered. */
  dangerous?: boolean;
}

export type PermissionResult = { ok: true } | { ok: false; reason: string };

const SAFE_COMMANDS = [
  "ls", "dir", "pwd", "cat", "head", "tail", "wc", "echo", "which", "where", "type", "tree", "file", "stat",
  "grep", "rg", "find", "du", "df", "date", "whoami", "uname", "env", "printenv",
  "git status", "git diff", "git log", "git show", "git branch", "git rev-parse", "git ls-files",
  "git remote -v", "git blame", "git stash list", "git tag", "git config --get",
  "node --version", "node -v", "npm --version", "npm ls", "npm list", "npm view", "npm outdated",
  "python --version", "python3 --version", "pip list", "pip show", "go version", "cargo --version",
  "dotnet --version", "dotnet --list-sdks", "java -version", "tsc --version",
];

const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b.*(\s\/(\s|$)|\s~|\s\*|\s\.\.?(\s|$)|\$HOME)/i,
  /\bgit\s+push\b.*(--force\b|\s-f\b|--force-with-lease)/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/i,
  /\bgit\s+branch\s+-D\b/,
  /\b(mkfs|fdisk|diskpart|format\s+[a-z]:)/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|halt)\b/i,
  /:\(\)\s*\{.*\};\s*:/,
  /\bchmod\s+-R\s+777\s+\//,
  /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(sh|bash|iex|Invoke-Expression|python)/i,
  /\bdel\s+\/[sq]/i,
  /\bRemove-Item\b.*-Recurse/i,
  /\brd\s+\/s/i,
  /\bnpm\s+publish\b/i,
  /\bDROP\s+(TABLE|DATABASE)\b/i,
];

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((re) => re.test(command));
}

/** True when every part of a command line is a known read-only command. */
export function isSafeCommand(command: string, extra: string[] = []): boolean {
  if (/[`]|\$\(|>|<\(/.test(command.replace(/2>&1/g, "").replace(/\d?>\s*\/dev\/null/g, ""))) return false;
  const parts = command.split(/&&|\|\||;|\|/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return false;
  const allowed = [...SAFE_COMMANDS, ...extra];
  return parts.every((part) => {
    if (/^find\b/.test(part) && /-(exec|execdir|delete|ok)\b/.test(part)) return false;
    return allowed.some((prefix) => part === prefix || part.startsWith(prefix + " "));
  });
}

/** First words of a command, used as the "always allow" key. */
export function commandKey(command: string): string {
  const words = command.trim().split(/\s+/);
  const n = ["git", "npm", "npx", "pnpm", "yarn", "dotnet", "cargo", "go", "python", "pip", "uv", "docker", "make"].includes(words[0]) ? 2 : 1;
  return words.slice(0, n).join(" ");
}

export const PLAN_MODE_DENIAL =
  "Plan mode is on: nothing may be modified or executed yet (only read-only commands run). Keep investigating, " +
  "then call present_plan with your plan so the user can approve it.";

export class Permissions {
  mode: PermissionMode;
  /** Mode restored when the user approves a plan. */
  private planReturnMode: PermissionMode = "ask";
  private readonly ui: UI;
  private readonly allowed = new Set<string>();
  readonly extraSafeCommands: string[];

  constructor(mode: PermissionMode, ui: UI, extraSafeCommands: string[]) {
    this.mode = mode;
    this.ui = ui;
    this.extraSafeCommands = extraSafeCommands;
  }

  enterPlanMode(): void {
    if (this.mode !== "plan") this.planReturnMode = this.mode;
    this.mode = "plan";
  }

  /** Leaves plan mode and returns the mode now in effect. */
  exitPlanMode(): PermissionMode {
    if (this.mode === "plan") this.mode = this.planReturnMode;
    return this.mode;
  }

  private needsAsking(req: PermissionRequest): boolean {
    if (req.dangerous) return true;
    if (this.allowed.has(`${req.kind}:${req.key}`)) return false;
    if (this.mode === "yolo") return false;
    if (this.mode === "auto-edit" && req.kind === "edit") return false;
    return true;
  }

  async request(req: PermissionRequest): Promise<PermissionResult> {
    if (this.mode === "plan" && req.kind !== "outside") return { ok: false, reason: PLAN_MODE_DENIAL };
    if (!this.needsAsking(req)) return { ok: true };
    if (!this.ui.interactive) {
      return { ok: false, reason: `Permission denied: "${req.title}" needs approval and the session is not interactive (use --mode auto-edit or --mode yolo).` };
    }
    this.ui.line();
    this.ui.line(c.yellow(c.bold(`⚠ Permission required: ${req.title}`)) + (req.dangerous ? c.red(c.bold("  [DANGEROUS ACTION]")) : ""));
    if (req.detail) this.ui.line(req.detail);
    const always = req.dangerous ? "" : ` / ${c.bold("a")}lways this session (${req.key})`;
    const answer = (await this.ui.ask(`${c.bold("y")}es / ${c.bold("n")}o${always} / or type instructions › `)).trim();
    const lower = answer.toLowerCase();
    if (["y", "yes"].includes(lower)) return { ok: true };
    if (!req.dangerous && ["a", "always"].includes(lower)) {
      this.allowed.add(`${req.kind}:${req.key}`);
      return { ok: true };
    }
    if (!answer || ["n", "no"].includes(lower)) {
      return { ok: false, reason: "The user rejected this action. Do not retry it; ask what they prefer or take a different approach." };
    }
    return { ok: false, reason: `The user rejected this action with these instructions: ${answer}` };
  }
}
