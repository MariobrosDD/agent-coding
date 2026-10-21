# coding-agent

A terminal coding agent powered by **Claude Opus 5.5**, built to take on any programming task at full rigor — from a quick script to safety-critical flight software. It reads, searches and edits code, runs commands, tests and long-running processes, works with git, researches documentation on the web, asks you when something is unclear, plans before risky changes, reviews its own work, and remembers your preferences across sessions. It asks for permission before any action with side effects.

## Requirements

- Node.js 23.6 or later (it runs TypeScript directly, with no build step).
- An Anthropic API key: <https://console.anthropic.com>.
- Optional: Git (and Git Bash on Windows; without it, the agent uses PowerShell).

## Installation

```bash
npm install
```

Set your key (PowerShell, for the current session):

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

To keep it saved for your Windows user: `setx ANTHROPIC_API_KEY "sk-ant-..."`. Then open a new terminal.

To use the `coding-agent` command from any folder:

```bash
npm link
```

## Usage

```bash
coding-agent                         # interactive session in the current folder
coding-agent "add tests for utils"   # start straight away with a request
coding-agent --mode plan "port the orbit propagator to Rust"   # plan first, implement after approval
coding-agent -p "explain src/"       # a single request, non-interactive
coding-agent -c                      # continue the last conversation
coding-agent -C path/to/project      # work in another folder
```

Options: `--model`, `--effort low|medium|high|xhigh|max`, `--mode ask|auto-edit|yolo|plan`, `--resume <file>`, `--no-web`. Use `--help` to see them all.

### Commands inside a session

| Command | What it does |
|---|---|
| `/plan [task]` | Plan mode: the agent investigates read-only, asks what it needs, and proposes a plan; nothing changes until you approve it. `/plan off` leaves it |
| `/review` | Critical review of the changes by a reviewer subagent, then fixes for confirmed issues |
| `/mode ask\|auto-edit\|yolo\|plan` | Permission mode |
| `/undo` | Undo the file changes from the last request |
| `/verify [command]` | Run verification (uses the detected command if none is set) or set the command |
| `/autoverify on` | Verify automatically after every change |
| `/guides` | Expert guides the agent can load |
| `/init` | Analyze the project and write `AGENT.md` with its instructions |
| `/model`, `/effort` | Change the model or the reasoning level |
| `/todos`, `/memory`, `/sessions`, `/cost`, `/diff`, `/clear`, `/exit` | Task list, memory, saved conversations, cost, changes, new conversation and quit |

**Ctrl+C** interrupts the agent without losing the conversation (also while it is asking you something). End a line with `\` to keep typing on the next one. Pasted multi-line text is sent as a single message.

## How it works on a task

For anything non-trivial, the agent follows the same workflow:

1. **Understand** — explores the code (in parallel with subagents for broad sweeps), reads project instructions, and loads the expert guides for every domain involved.
2. **Clarify** — if the goal, scope, constraints or acceptance criteria are unclear, it asks you (`ask_user`) with concrete options and a recommendation, instead of guessing. It does not ask what it can find out itself.
3. **Plan** — breaks the work into a visible task list; for large or risky changes it presents a plan for your approval (`present_plan`).
4. **Implement** — small steps that follow the codebase's conventions, with no placeholders or fake implementations.
5. **Verify** — builds, type-checks, lints and tests with the project's own tooling; adds tests for new behavior and regression tests for bugs.
6. **Review** — re-reads its full diff as a critical reviewer and, for substantial changes, has a reviewer subagent hunt for defects.
7. **Report** — what changed, how it was verified, what was assumed, and what is left.

By default it reasons at **maximum effort** (`effort: max`, up to 128K output tokens and 400 steps per request). That gives the best results but costs more per request; lower it with `/effort high` or in the configuration for routine work.

## Ready for any technology

- **Expert guides** loaded on demand: safety-critical (NASA/JPL Power of Ten, MISRA, DO-178C, ISO 26262), scientific computing and astrodynamics, embedded systems, systems programming and performance, web frontend, backend services, databases, security, data and ML, DevOps and infrastructure, mobile, games and graphics, desktop and CLI tools, testing, debugging, legacy code and refactoring, and new projects. Add your own as Markdown files in `.agent/guides/` (project) or `~/.coding-agent/guides/` (global), with `name` and `description` front matter; a guide with the same name overrides the built-in one.
- **Environment detection** at startup: installed toolchains and their versions (Node, Python, Go, Rust, Java, .NET, C/C++, Fortran, Julia, R, Docker, Terraform…), the project type, frameworks, scripts, and the most likely verification command.
- **Current documentation**: it checks the versions actually used by the project and reads the docs for those versions (web search and fetch, or the installed library sources) instead of relying on memory.
- **Specs and papers**: it reads PDF documents (requirements, datasheets, papers) and images.

## Tools

| Area | Tools |
|---|---|
| Files | `read_file` (also images and PDFs), `write_file`, `edit_file`, `multi_edit` (atomic), `list_dir` |
| Search | `glob`, `grep` (both respect `.gitignore`) |
| Execution | `bash` with a timeout and bounded output; background jobs (`run_in_background`, `job_output` with wait-for-pattern, `job_kill`) for servers, watchers and long simulations |
| Git | `git_status`, `git_diff`, `git_log`, `git_commit` (only when you ask) |
| Web | Search and page fetching (Anthropic server tools) |
| Interaction | `ask_user` (clarifying questions with options), `present_plan` (plan approval) |
| Knowledge | `load_guide` (expert guides), `remember` (persistent memory) |
| Organization | `todo_write` (visible plan), `task` (read-only subagents in parallel, for research and reviews) |

## Reliability and safety

- **Permissions.** In `ask` mode (the default) it asks before editing files or running commands and shows you the diff or the command. You can answer *yes*, *no*, *always this session*, or type an instruction, which is passed to the agent. Read-only commands (`git status`, `ls`, `grep`…) don't ask. Dangerous actions (`rm -rf /`, `git push --force`, `git reset --hard`, `curl … | sh`…) always ask, even in `yolo` mode. In `plan` mode nothing can be modified until you approve a plan.
- **Safe edits.** It can't edit a file it hasn't read first. If you changed the file after it read it, it won't modify it. The text it replaces must be unique. It keeps CRLF line endings. It never writes inside `.git`, and it needs your permission to touch files outside the project (symlinks, junctions and Windows short paths are resolved correctly).
- **Verification.** Its instructions require it to verify its changes and report honestly, including what it could not verify (for example, code that needs hardware). With `/autoverify on`, your verification command runs after every change and, if it fails, the agent gets the output and fixes it (up to 3 attempts).
- **Undo.** `/undo` restores the files it changed in the last request. Changes made through shell commands can't be undone this way; use git for those.
- **API robustness.** It retries network, rate-limit and server errors automatically. It enables automatic model fallback if Claude declines a request, and context compaction for long conversations. It validates every tool input before running it. If a response gets cut off, it asks again instead of running an incomplete command.
- **Prompt caching.** The history only grows (it is never rewritten), so most of each request is served from cache and costs much less.

## Configuration

Edit `.agent/config.json` in the project, or `~/.coding-agent/config.json` for every project. If both exist, the project one wins:

```json
{
  "model": "claude-opus-5-5",
  "effort": "max",
  "subagentEffort": "high",
  "permissionMode": "ask",
  "verify": { "command": "npm run typecheck && npm test", "auto": true },
  "allowedCommands": ["npm test", "npm run lint"]
}
```

Every option and its default value is in [src/config.ts](src/config.ts). For the hardest tasks you can also switch to Anthropic's most capable model with `--model claude-fable-5-1` (about 2.5 times the price of Opus 5.5).

**Project instructions:** if the root has an `AGENT.md`, `AGENTS.md` or `CLAUDE.md`, the agent reads and follows it. You can generate one with `/init`.
**Memory:** what the agent saves with `remember` goes to `.agent/memory.md` (project) or `~/.coding-agent/memory.md` (global).
**Conversations:** saved in `.agent/sessions/`, which is excluded from git automatically.

## Development

```bash
npm run typecheck   # type check
npm test            # tests for the tools, the agent loop and the new capabilities (no API key needed)
```

Layout: [src/agent.ts](src/agent.ts) (agent loop), [src/tools/](src/tools) (tools), [guides/](guides) (expert guides), [src/environment.ts](src/environment.ts) (environment detection), [src/permissions.ts](src/permissions.ts), [src/prompt.ts](src/prompt.ts) (system instructions), [src/index.ts](src/index.ts) (CLI).
