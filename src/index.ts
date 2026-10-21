import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Agent, describeApiError } from "./agent.ts";
import { Checkpoints } from "./checkpoints.ts";
import { loadConfig, type Config, type Effort, type PermissionMode } from "./config.ts";
import { Permissions } from "./permissions.ts";
import { detectProject, detectToolchains } from "./environment.ts";
import { CostTracker } from "./pricing.ts";
import { buildSystemPrompt, PLAN_MODE_NOTE } from "./prompt.ts";
import { SessionStore } from "./session.ts";
import { ALL_TOOLS, SUBAGENT_TOOLS } from "./tools/index.ts";
import { git, isGitRepo } from "./tools/git.ts";
import { listGuides } from "./tools/guides.ts";
import { memoryFile, renderTodos } from "./tools/meta.ts";
import { detectShell, runCommand } from "./tools/shell.ts";
import { c, exitSoon, oneLine, UI } from "./ui.ts";

const VERSION = "1.0.0";
const MODES: PermissionMode[] = ["ask", "auto-edit", "yolo", "plan"];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

const HELP = `
${c.bold("coding-agent")} — terminal coding agent powered by Claude

${c.bold("Usage")}
  coding-agent [options] [initial request]
  coding-agent -p "request"        run a single request and exit (non-interactive)
  echo "request" | coding-agent    same, reading the request from stdin

${c.bold("Options")}
  -p, --print <text>       non-interactive mode
  -m, --model <id>         model (default claude-opus-5-5)
  -e, --effort <level>     low | medium | high | xhigh | max (default max)
      --mode <mode>        ask (asks before editing/running) | auto-edit | yolo | plan (plan first, then approve)
  -c, --continue           continue the last conversation in this project
  -r, --resume <file>      continue a specific saved conversation
  -C, --cwd <dir>          project folder (default: current folder)
      --no-web             disable web search
  -h, --help               show this help
  -v, --version            show the version
`;

const COMMANDS_HELP = `
${c.bold("Commands")}
  /help                 this help
  /plan [task]          plan mode: investigate and propose a plan for approval before changing anything
  /plan off             leave plan mode
  /review               critical review of the changes (with a reviewer subagent) and fixes
  /mode [mode]          permissions: ask | auto-edit | yolo | plan
  /model [id]           show or change the model
  /effort [level]       show or change the reasoning effort
  /undo                 undo the file changes from the last request
  /diff                 summary of changes (git)
  /verify [command]     run verification, or set the command (e.g. /verify npm test)
  /autoverify on|off    verify automatically after every change
  /guides               expert guides available to the agent
  /todos                current task list
  /memory               show saved memory
  /init                 analyze the project and write AGENT.md with its instructions
  /sessions             saved conversations
  /cost                 tokens and estimated cost
  /clear                start a new conversation
  /exit                 quit

  Ctrl+C interrupts the agent · end a line with \\ to write several lines
`;

const INIT_PROMPT = `Analyze this project and create (or improve, if it already exists) the AGENT.md file at the root. Keep it concise (under 100 lines) and include:
- What the project is, in 2-3 lines.
- Exact commands to install dependencies, build, run, run the tests and run the linter. Confirm them by reading the configuration files and, when safe, by running them.
- The main folder structure and where each thing lives.
- Code conventions you observe (style, naming, patterns, comment language).
Leave out the obvious and anything generic. At the end, tell me which verification command you recommend for /verify.`;

function reviewPrompt(changedFiles: string[]): string {
  const files = changedFiles.length ? `Files you changed in this session:\n${changedFiles.map((f) => `- ${f}`).join("\n")}\n\n` : "";
  return `Review the changes critically before we consider them done.
${files}1. Collect the full set of changes (git_diff and git_status if this is a git repository; otherwise re-read the changed files).
2. Launch a reviewer subagent with the task tool. Give it the goal of the changes and the list of changed files, and ask it to hunt for real defects: wrong logic, unhandled edge cases and errors, broken contracts or callers, security issues, concurrency problems, missing or weak tests, and anything that does not match the codebase's conventions. Ask for findings ranked by severity with file:line references.
3. Check every finding yourself. Fix the confirmed ones, then re-run the project's verification.
4. Report what was found, what you fixed, what you dismissed and why, and the verification results.`;
}

interface Args {
  print?: string;
  prompt?: string;
  model?: string;
  effort?: string;
  mode?: string;
  cont: boolean;
  resume?: string;
  cwd?: string;
  noWeb: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { cont: false, noWeb: false };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) fail(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "-p": case "--print": args.print = value(); break;
      case "-m": case "--model": args.model = value(); break;
      case "-e": case "--effort": args.effort = value(); break;
      case "--mode": args.mode = value(); break;
      case "-c": case "--continue": args.cont = true; break;
      case "-r": case "--resume": args.resume = value(); break;
      case "-C": case "--cwd": args.cwd = value(); break;
      case "--no-web": args.noWeb = true; break;
      case "-h": case "--help": console.log(HELP); process.exit(0); break;
      case "-v": case "--version": console.log(VERSION); process.exit(0); break;
      default:
        if (a.startsWith("-")) fail(`Unknown option: ${a} (use --help)`);
        rest.push(a);
    }
  }
  if (rest.length) args.prompt = rest.join(" ");
  return args;
}

function fail(message: string): never {
  console.error(c.red(message));
  process.exit(2);
}

function applyArgs(config: Config, args: Args): void {
  if (args.model) config.model = args.model;
  if (args.effort) {
    if (!EFFORTS.includes(args.effort as Effort)) fail(`Invalid effort: ${args.effort}`);
    config.effort = args.effort as Effort;
  }
  if (args.mode) {
    if (!MODES.includes(args.mode as PermissionMode)) fail(`Invalid mode: ${args.mode}`);
    config.permissionMode = args.mode as PermissionMode;
  }
  if (args.noWeb) config.web = false;
}

async function gitInfo(root: string): Promise<{ branch: string; status: string } | null> {
  if (!(await isGitRepo(root))) return null;
  const branch = (await git(["branch", "--show-current"], root).catch(() => "")).trim() || "(detached HEAD)";
  const status = (await git(["status", "--short"], root).catch(() => "")).trim();
  return { branch, status };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.cwd ?? process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`Folder does not exist: ${root}`);
  const config = loadConfig(root);
  applyArgs(config, args);

  let printPrompt = args.print;
  if (printPrompt === undefined && !process.stdin.isTTY) {
    printPrompt = [args.prompt, await readStdin()].filter(Boolean).join("\n\n");
  }
  const interactive = printPrompt === undefined;
  if (!interactive && !printPrompt?.trim()) fail("The request is empty.");

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error(c.yellow("Warning: ANTHROPIC_API_KEY is not set; other credentials will be tried (an `ant auth login` profile)."));
  }

  const ui = new UI(interactive);
  const client = new Anthropic({ maxRetries: 4 });
  const shell = detectShell(config.shell);
  if (interactive) process.stdout.write(c.dim("  detecting environment…\r"));
  const [gitState, toolchains] = await Promise.all([gitInfo(root), detectToolchains()]);
  if (interactive) process.stdout.write("\x1b[2K");
  const project = detectProject(root);
  const guides = listGuides(root);
  const env = { root, shellName: shell.name, config, git: gitState, toolchains, project, guides };
  const systemPrompt = buildSystemPrompt(env, false);
  const subagentPrompt = buildSystemPrompt(env, true);
  const permissions = new Permissions(config.permissionMode, ui, config.allowedCommands);
  const checkpoints = new Checkpoints();
  const cost = new CostTracker();

  let store: SessionStore;
  const createAgent = () =>
    new Agent({
      client, config, ui, root, permissions, checkpoints, cost,
      tools: ALL_TOOLS,
      systemPrompt,
      spawnSubagent: (description) =>
        new Agent({
          client, config, ui, root, permissions, checkpoints, cost,
          tools: SUBAGENT_TOOLS,
          systemPrompt: subagentPrompt,
          quiet: true,
          label: description,
          effort: config.subagentEffort,
        }),
      onTurnEnd: (a) => {
        try {
          store.save(config.model, a.messages, a.todos);
        } catch (err) {
          ui.line(c.yellow(`(could not save the session: ${(err as Error).message})`));
        }
      },
    });

  let agent = createAgent();
  const resumeFile = args.resume ? path.resolve(args.resume) : args.cont ? SessionStore.list(root)[0]?.file : undefined;
  if (args.cont && !resumeFile) ui.line(c.yellow("No previous conversations in this project; starting a new one."));
  if (resumeFile) {
    const data = SessionStore.load(resumeFile);
    agent.messages = data.messages;
    agent.todos.push(...data.todos);
    store = new SessionStore(root, resumeFile);
  } else {
    store = new SessionStore(root);
  }
  ui.onInterrupt = () => agent.interrupt();

  const runPrompt = async (text: string): Promise<boolean> => {
    checkpoints.beginTurn(oneLine(text, 60));
    try {
      await agent.run(permissions.mode === "plan" ? PLAN_MODE_NOTE + text : text);
      return true;
    } catch (err) {
      ui.line(c.red(`✗ ${describeApiError(err)}`));
      return false;
    }
  };

  if (!interactive) {
    const ok = await runPrompt(printPrompt!);
    ui.line(c.dim(cost.summary()));
    // Let the event loop drain instead of process.exit(): exiting while stdin is closing crashes libuv on Windows.
    process.exitCode = ok ? 0 : 1;
    return;
  }

  ui.line(`${c.bold(c.cyan("◆ coding-agent"))} ${c.dim(`v${VERSION} · ${config.model} · effort ${config.effort} · permissions ${config.permissionMode}`)}`);
  ui.line(c.dim(`  ${root}${env.git ? ` (git: ${env.git.branch})` : ""} · shell ${shell.name}${config.verify.command ? ` · verify: ${config.verify.command}${config.verify.auto ? " (auto)" : ""}` : ""}`));
  ui.line(c.dim(`  ${project.facts[0] ?? "no project manifest detected"} · ${toolchains.length} toolchains · ${guides.length} expert guides`));
  if (resumeFile) ui.line(c.dim(`  continuing conversation (${agent.messages.length} messages)`));
  ui.line(c.dim("  /help for commands · /plan to plan before changing anything · Ctrl+C interrupts"));

  const handleCommand = async (line: string): Promise<boolean> => {
    const [cmd, ...restWords] = line.slice(1).split(/\s+/);
    const rest = restWords.join(" ").trim();
    switch (cmd) {
      case "help": case "?":
        ui.line(COMMANDS_HELP);
        break;
      case "exit": case "quit": case "q":
        return false;
      case "clear":
        agent = createAgent();
        store = new SessionStore(root);
        ui.line(c.dim("New conversation."));
        break;
      case "mode":
        if (rest) {
          if (!MODES.includes(rest as PermissionMode)) ui.line(c.red(`Modes: ${MODES.join(", ")}`));
          else if (rest === "plan") permissions.enterPlanMode();
          else permissions.mode = rest as PermissionMode;
        }
        ui.line(`Permissions: ${c.bold(permissions.mode)} ${c.dim("(ask: asks before editing and running · auto-edit: edits without asking · yolo: never asks except for dangerous actions · plan: read-only until you approve a plan)")}`);
        break;
      case "plan":
        if (rest === "off") {
          ui.line(`Plan mode off · permissions: ${c.bold(permissions.exitPlanMode())}`);
          break;
        }
        permissions.enterPlanMode();
        ui.line(c.cyan("Plan mode on: the agent will investigate and propose a plan; nothing changes until you approve it."));
        if (rest) await runPrompt(rest);
        break;
      case "review":
        await runPrompt(reviewPrompt(checkpoints.changedInSession().map((f) => path.relative(root, f))));
        break;
      case "guides":
        for (const g of guides) ui.line(`${c.bold(g.name)} ${c.dim(`(${g.source})`)}\n  ${c.dim(g.description)}`);
        ui.line(c.dim(`Add your own as Markdown files in ${path.join(root, ".agent", "guides")} (with name/description front matter).`));
        break;
      case "model":
        if (rest) {
          config.model = rest;
          ui.line(c.dim("(switching models invalidates the conversation cache: the next request will cost more)"));
        }
        ui.line(`Model: ${c.bold(config.model)}`);
        break;
      case "effort":
        if (rest) {
          if (!EFFORTS.includes(rest as Effort)) ui.line(c.red(`Levels: ${EFFORTS.join(", ")}`));
          else config.effort = rest as Effort;
        }
        ui.line(`Effort: ${c.bold(config.effort)}`);
        break;
      case "undo": {
        const undone = await checkpoints.undo();
        if (!undone) ui.line(c.dim("Nothing to undo."));
        else {
          ui.line(c.green(`Undid the changes from "${undone.label}":`));
          for (const f of undone.files) ui.line(c.dim(`  ${path.relative(root, f)}`));
          agent.fileState.clear();
          // Consecutive user messages are merged by the API, so this note simply precedes the next prompt.
          agent.messages.push({ role: "user", content: `[System note] The user undid (with /undo) the changes you made to: ${undone.files.map((f) => path.relative(root, f)).join(", ")}. Read those files again before touching them.` });
        }
        break;
      }
      case "diff":
        if (!env.git) ui.line(c.dim("Not a git repository."));
        else ui.line((await git(["diff", "--stat"], root).catch((e) => String(e.message))).trim() || c.dim("No unstaged changes."));
        break;
      case "verify": {
        if (rest) {
          config.verify.command = rest;
          ui.line(c.dim(`Verification command: ${rest} (to keep it, add it to .agent/config.json)`));
        }
        if (!config.verify.command && project.verifyCommand) {
          config.verify.command = project.verifyCommand;
          ui.line(c.dim(`Using the detected verification command: ${project.verifyCommand} (change it with /verify <command>)`));
        }
        if (!config.verify.command) {
          ui.line(c.yellow("No verification command set or detected. Use it like this: /verify npm test"));
          break;
        }
        ui.startSpinner("verifying");
        const ctrl = new AbortController();
        ui.onInterrupt = () => (ctrl.abort(), true);
        const res = await runCommand(shell, config.verify.command, root, config.verify.timeoutSec * 1000, ctrl.signal, config.maxToolOutputChars);
        ui.onInterrupt = () => agent.interrupt();
        ui.stopSpinner();
        ui.line(res.output.trim());
        ui.line(res.exitCode === 0 ? c.green("✔ verification passed") : c.red(`✗ verification failed (exit code ${res.exitCode})`));
        break;
      }
      case "autoverify":
        if (rest === "on" || rest === "off") config.verify.auto = rest === "on";
        ui.line(`Automatic verification: ${c.bold(config.verify.auto ? "on" : "off")}${config.verify.command ? "" : c.yellow(" (set the command first with /verify <command>)")}`);
        break;
      case "todos":
        ui.line(agent.todos.length ? renderTodos(agent.todos) : c.dim("No tasks."));
        break;
      case "memory":
        for (const scope of ["project", "global"] as const) {
          const file = memoryFile(root, scope);
          const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
          ui.line(c.bold(scope === "project" ? "Project" : "Global") + c.dim(` (${file})`));
          ui.line(text || c.dim("  (empty)"));
        }
        break;
      case "init":
        await runPrompt(INIT_PROMPT);
        break;
      case "sessions": {
        const sessions = SessionStore.list(root).slice(0, 15);
        if (!sessions.length) ui.line(c.dim("No saved conversations."));
        for (const s of sessions) ui.line(`${c.dim(s.updatedAt.slice(0, 16).replace("T", " "))}  ${oneLine(s.title, 60)}\n  ${c.dim(s.file)}`);
        if (sessions.length) ui.line(c.dim("To continue one: coding-agent --resume <file>"));
        break;
      }
      case "cost":
        ui.line(cost.summary());
        break;
      default:
        ui.line(c.red(`Unknown command: /${cmd}. Use /help.`));
    }
    return true;
  };

  let initial = args.prompt;
  for (;;) {
    const input = initial ?? (await ui.nextInput(c.bold(c.cyan("\n› "))));
    initial = undefined;
    if (input === null) break;
    const text = input.trim();
    if (!text) continue;
    if (text.startsWith("/") && !text.includes("\n")) {
      if (!(await handleCommand(text))) break;
      continue;
    }
    await runPrompt(text);
    ui.line(c.dim(`  ${cost.summary()}`));
  }
  ui.close();
  ui.line(c.dim(cost.summary()));
  exitSoon(0);
}

main().catch((err) => {
  console.error(c.red(describeApiError(err)));
  process.exit(1);
});
