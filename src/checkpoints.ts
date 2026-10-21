import fs from "node:fs/promises";
import path from "node:path";

/**
 * Remembers the original content of every file the agent changes, grouped
 * by user turn, so /undo can restore them. Changes made through the shell
 * are not tracked.
 */
export class Checkpoints {
  private turns: { label: string; files: Map<string, string | null> }[] = [];

  beginTurn(label: string): void {
    this.turns.push({ label, files: new Map() });
  }

  /** Call before modifying `file`. Only the first snapshot per turn is kept. */
  async snapshot(file: string): Promise<void> {
    const turn = this.turns.at(-1);
    if (!turn || turn.files.has(file)) return;
    try {
      turn.files.set(file, await fs.readFile(file, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      turn.files.set(file, null);
    }
  }

  changedInCurrentTurn(): string[] {
    return [...(this.turns.at(-1)?.files.keys() ?? [])];
  }

  /** Every file changed in this session that has not been undone. */
  changedInSession(): string[] {
    return [...new Set(this.turns.flatMap((t) => [...t.files.keys()]))];
  }

  /** Restores the most recent turn that changed files. Returns what was restored. */
  async undo(): Promise<{ label: string; files: string[] } | null> {
    while (this.turns.length) {
      const turn = this.turns.pop()!;
      if (!turn.files.size) continue;
      for (const [file, content] of turn.files) {
        if (content === null) {
          await fs.rm(file, { force: true });
        } else {
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, content, "utf8");
        }
      }
      return { label: turn.label, files: [...turn.files.keys()] };
    }
    return null;
  }
}
