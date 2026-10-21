import readline from "node:readline";
import { styleText } from "node:util";

type Style = Parameters<typeof styleText>[0];

const paint = (style: Style) => (text: string) => styleText(style, text, { stream: process.stdout });

export const c = {
  dim: paint("dim"),
  bold: paint("bold"),
  red: paint("red"),
  green: paint("green"),
  yellow: paint("yellow"),
  blue: paint("blue"),
  cyan: paint("cyan"),
  magenta: paint("magenta"),
  gray: paint("gray"),
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Terminal I/O. Lines typed while no question is pending are buffered into
 * user prompts; pasted multi-line text arrives as a burst of lines and is
 * joined into one prompt.
 */
export class UI {
  readonly interactive: boolean;
  private rl: readline.Interface | null = null;
  private pendingAnswer: ((line: string) => void) | null = null;
  private pendingInput: ((text: string | null) => void) | null = null;
  private buffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private lastSigint = 0;
  private closed = false;
  /** Called on Ctrl+C while the agent is working. Returns true if something was interrupted. */
  onInterrupt: () => boolean = () => false;
  /** Text currently on the line without a trailing newline (for tidy spinner/line handling). */
  private midLine = false;

  constructor(interactive: boolean) {
    this.interactive = interactive;
    if (!interactive) return;
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    this.rl.on("line", (line) => this.handleLine(line));
    this.rl.on("SIGINT", () => this.handleSigint());
    this.rl.on("close", () => {
      this.closed = true;
      this.pendingAnswer?.("");
      this.pendingInput?.(null);
    });
  }

  private handleLine(line: string): void {
    if (this.pendingAnswer) {
      const resolve = this.pendingAnswer;
      this.pendingAnswer = null;
      resolve(line);
      return;
    }
    this.buffer.push(line);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    // A trailing backslash means "continue on the next line".
    if (line.endsWith("\\")) {
      this.buffer[this.buffer.length - 1] = line.slice(0, -1);
      process.stdout.write(c.dim("… "));
      return;
    }
    this.flushTimer = setTimeout(() => this.flush(), 30);
  }

  private flush(): void {
    this.flushTimer = null;
    if (!this.pendingInput) return; // keep buffering until someone asks for input
    const text = this.buffer.join("\n");
    this.buffer = [];
    const resolve = this.pendingInput;
    this.pendingInput = null;
    resolve(text);
  }

  private handleSigint(): void {
    if (this.pendingAnswer) {
      // Ctrl+C at a question declines it and interrupts the whole turn.
      const resolve = this.pendingAnswer;
      this.pendingAnswer = null;
      process.stdout.write("\n");
      this.onInterrupt();
      resolve("");
      return;
    }
    if (this.onInterrupt()) return;
    const now = Date.now();
    if (now - this.lastSigint < 2000) {
      this.close();
      exitSoon(0);
      return;
    }
    this.lastSigint = now;
    this.buffer = [];
    process.stdout.write(c.dim("\n(press Ctrl+C again to exit)\n"));
    this.rl?.prompt();
  }

  /** Waits for the next user prompt. Returns null when stdin closes. */
  nextInput(promptText: string): Promise<string | null> {
    if (this.closed || !this.rl) return Promise.resolve(null);
    this.rl.setPrompt(promptText);
    this.rl.prompt();
    return new Promise((resolve) => {
      this.pendingInput = resolve;
      if (this.buffer.length && !this.flushTimer) this.flush();
    });
  }

  /** Asks a question and returns the raw answer. Non-interactive sessions get "". */
  ask(question: string): Promise<string> {
    if (this.closed || !this.rl) return Promise.resolve("");
    this.stopSpinner();
    this.ensureNewline();
    process.stdout.write(question);
    return new Promise((resolve) => {
      this.pendingAnswer = resolve;
    });
  }

  write(text: string): void {
    this.stopSpinner();
    if (!text) return;
    process.stdout.write(text);
    this.midLine = !text.endsWith("\n");
  }

  line(text = ""): void {
    this.stopSpinner();
    this.ensureNewline();
    process.stdout.write(text + "\n");
  }

  ensureNewline(): void {
    if (this.midLine) {
      process.stdout.write("\n");
      this.midLine = false;
    }
  }

  startSpinner(label: string): void {
    if (!process.stdout.isTTY || this.spinnerTimer) return;
    this.ensureNewline();
    let i = 0;
    const started = Date.now();
    this.spinnerTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      process.stdout.write(`\r${c.cyan(SPINNER[i++ % SPINNER.length])} ${c.dim(`${label} (${secs}s · Ctrl+C to interrupt)`)}`);
    }, 100);
  }

  stopSpinner(): void {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
    process.stdout.write("\r\x1b[2K");
  }

  close(): void {
    this.stopSpinner();
    this.rl?.close();
  }
}

/**
 * Exits once pending output is flushed. Calling process.exit() while stdin is
 * still closing crashes libuv on Windows, so give the event loop a moment.
 */
export function exitSoon(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 300).unref();
}

export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  const tail = max - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n\n[... ${omitted} characters omitted ...]\n\n${text.slice(-tail)}`;
}

export function oneLine(text: string, max = 100): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}
