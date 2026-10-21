import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { diffStats, renderDiff } from "../diff.ts";
import { c } from "../ui.ts";
import { displayPath, isBinary, listFiles, resolvePath } from "./paths.ts";
import { defineTool, ToolError, type ToolContext } from "./types.ts";

const MAX_LINES = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_READ_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const toPosix = (p: string) => p.split(path.sep).join("/");

async function remember(ctx: ToolContext, file: string): Promise<void> {
  ctx.fileState.set(file, (await fs.stat(file)).mtimeMs);
}

/** Refuses to change a file the agent has not read, or that changed since it was read. */
async function assertFresh(ctx: ToolContext, file: string): Promise<void> {
  const seen = ctx.fileState.get(file);
  if (seen === undefined) {
    throw new ToolError("You must read the file with read_file before modifying it.");
  }
  const now = (await fs.stat(file)).mtimeMs;
  if (now !== seen) {
    throw new ToolError("The file has changed since you last read it (the user or a command may have edited it). Read it again before modifying it.");
  }
}

async function approveChange(ctx: ToolContext, file: string, before: string | null, after: string): Promise<void> {
  const rel = displayPath(ctx.root, file);
  const verdict = await ctx.permissions.request({
    kind: "edit",
    key: "edit files",
    title: before === null ? `Create ${rel}` : `Modify ${rel}`,
    detail: before === null ? renderDiff("", after, 0, 40) : renderDiff(before, after),
  });
  if (!verdict.ok) throw new ToolError(verdict.reason);
}

async function writeChecked(ctx: ToolContext, file: string, before: string | null, after: string): Promise<string> {
  await ctx.checkpoints.snapshot(file);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, after, "utf8");
  await remember(ctx, file);
  const { added, removed } = before === null ? { added: after.split("\n").filter((l, i, all) => l || i < all.length - 1).length, removed: 0 } : diffStats(before, after);
  ctx.ui.line(c.dim(`  ${before === null ? "created" : "modified"} ${displayPath(ctx.root, file)} `) + c.green(`+${added}`) + " " + c.red(`-${removed}`));
  return `${before === null ? "Created" : "Updated"} ${displayPath(ctx.root, file)} (+${added} -${removed} lines).`;
}

/** Replaces `oldStr` in `content`, tolerating CRLF files edited with LF strings. */
function applyEdit(content: string, oldStr: string, newStr: string, replaceAll: boolean): string {
  if (oldStr === newStr) throw new ToolError("old_string and new_string are identical.");
  if (content.includes("\r\n") && !oldStr.includes("\r\n")) {
    oldStr = oldStr.replace(/\n/g, "\r\n");
    newStr = newStr.replace(/\r?\n/g, "\r\n");
  }
  const count = oldStr ? content.split(oldStr).length - 1 : 0;
  if (count === 0) {
    throw new ToolError("old_string was not found in the file. It must match exactly (whitespace, indentation and line breaks included). Read the file again and copy the exact text.");
  }
  if (count > 1 && !replaceAll) {
    throw new ToolError(`old_string appears ${count} times. Add more context to make it unique, or use replace_all: true.`);
  }
  return replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, () => newStr);
}

export const readFile = defineTool({
  name: "read_file",
  description:
    "Reads a file from the project. Returns the content with line numbers (`N\\tline` format). " +
    `Reads up to ${MAX_LINES} lines by default; use offset/limit for large files. ` +
    "Also reads images (png, jpg, gif, webp) and PDF documents (specs, papers, datasheets). Always read a file before editing it.",
  schema: z.object({
    path: z.string().describe("File path (relative to the project root, or absolute)"),
    offset: z.number().int().min(1).optional().describe("First line to read (1-based)"),
    limit: z.number().int().min(1).optional().describe("Maximum number of lines"),
  }),
  readOnly: true,
  summarize: (i) => i.path + (i.offset ? `:${i.offset}` : ""),
  async run(input, ctx) {
    const file = await resolvePath(ctx, input.path, "read");
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) throw new ToolError(`Does not exist: ${input.path}`);
    if (stat.isDirectory()) throw new ToolError(`${input.path} is a directory; use list_dir.`);
    const ext = path.extname(file).toLowerCase();
    if (IMAGE_TYPES[ext]) {
      if (stat.size > 5 * 1024 * 1024) throw new ToolError("Image too large (max 5 MB).");
      const data = (await fs.readFile(file)).toString("base64");
      return [
        { type: "text", text: `Image ${displayPath(ctx.root, file)}:` },
        { type: "image", source: { type: "base64", media_type: IMAGE_TYPES[ext], data } },
      ];
    }
    if (ext === ".pdf") {
      if (stat.size > 20 * 1024 * 1024) throw new ToolError("PDF too large (max 20 MB). Split it or extract the relevant pages first.");
      const data = (await fs.readFile(file)).toString("base64");
      return [
        { type: "text", text: `PDF document ${displayPath(ctx.root, file)}:` },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: path.basename(file) },
      ];
    }
    if (stat.size > MAX_READ_BYTES && !input.offset) {
      throw new ToolError(`File is ${(stat.size / 1e6).toFixed(1)} MB; use offset and limit, or grep.`);
    }
    if (await isBinary(file)) throw new ToolError("This is a binary file; it cannot be read as text.");
    const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
    await remember(ctx, file);
    if (lines.length === 1 && lines[0] === "") return "(empty file)";
    const start = (input.offset ?? 1) - 1;
    const end = Math.min(lines.length, start + (input.limit ?? MAX_LINES));
    if (start >= lines.length) throw new ToolError(`The file only has ${lines.length} lines.`);
    const body = lines
      .slice(start, end)
      .map((line, i) => `${start + i + 1}\t${line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) + "…[line truncated]" : line}`)
      .join("\n");
    const more = end < lines.length ? `\n\n[Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]` : "";
    return body + more;
  },
});

export const writeFile = defineTool({
  name: "write_file",
  description:
    "Creates a file or replaces its entire content. To change parts of an existing file, use edit_file. " +
    "If the file already exists, you must have read it first.",
  schema: z.object({
    path: z.string().describe("File path"),
    content: z.string().describe("Full file content"),
  }),
  readOnly: false,
  summarize: (i) => i.path,
  async run(input, ctx) {
    const file = await resolvePath(ctx, input.path, "write");
    const before = await fs.readFile(file, "utf8").catch(() => null);
    if (before !== null) await assertFresh(ctx, file);
    await approveChange(ctx, file, before, input.content);
    return writeChecked(ctx, file, before, input.content);
  },
});

export const editFile = defineTool({
  name: "edit_file",
  description:
    "Replaces exact text in a file. old_string must match the current content exactly " +
    "(without the line-number prefixes from read_file) and be unique, unless replace_all is set. Include enough context to make it unique.",
  schema: z.object({
    path: z.string().describe("File path"),
    old_string: z.string().describe("Exact text to replace"),
    new_string: z.string().describe("Replacement text"),
    replace_all: z.boolean().optional().describe("Replace every occurrence"),
  }),
  readOnly: false,
  summarize: (i) => i.path,
  async run(input, ctx) {
    const file = await resolvePath(ctx, input.path, "write");
    const before = await fs.readFile(file, "utf8").catch(() => null);
    if (before === null) throw new ToolError(`Does not exist: ${input.path}. Use write_file to create it.`);
    await assertFresh(ctx, file);
    const after = applyEdit(before, input.old_string, input.new_string, input.replace_all ?? false);
    await approveChange(ctx, file, before, after);
    return writeChecked(ctx, file, before, after);
  },
});

export const multiEdit = defineTool({
  name: "multi_edit",
  description:
    "Applies several edits to one file atomically: they are applied in order and, if any fails, nothing changes. " +
    "Each edit follows the edit_file rules and applies to the result of the previous one.",
  schema: z.object({
    path: z.string().describe("File path"),
    edits: z
      .array(
        z.object({
          old_string: z.string(),
          new_string: z.string(),
          replace_all: z.boolean().optional(),
        }),
      )
      .min(1),
  }),
  readOnly: false,
  summarize: (i) => `${i.path} (${i.edits.length} edits)`,
  async run(input, ctx) {
    const file = await resolvePath(ctx, input.path, "write");
    const before = await fs.readFile(file, "utf8").catch(() => null);
    if (before === null) throw new ToolError(`Does not exist: ${input.path}.`);
    await assertFresh(ctx, file);
    let after = before;
    input.edits.forEach((edit, i) => {
      try {
        after = applyEdit(after, edit.old_string, edit.new_string, edit.replace_all ?? false);
      } catch (err) {
        throw new ToolError(`Edit ${i + 1}: ${(err as Error).message} (no changes were applied)`);
      }
    });
    await approveChange(ctx, file, before, after);
    return writeChecked(ctx, file, before, after);
  },
});

export const listDir = defineTool({
  name: "list_dir",
  description: "Lists a directory's contents (up to 2 levels deep), skipping folders such as node_modules and .git.",
  schema: z.object({
    path: z.string().optional().describe("Directory (defaults to the project root)"),
    depth: z.number().int().min(1).max(4).optional().describe("Depth (default 2)"),
  }),
  readOnly: true,
  summarize: (i) => i.path ?? ".",
  async run(input, ctx) {
    const dir = await resolvePath(ctx, input.path ?? ".", "read");
    const depth = input.depth ?? 2;
    const skip = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".next", "target", "obj"]);
    const out: string[] = [];
    let count = 0;
    async function visit(current: string, level: number, indent: string): Promise<void> {
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => null);
      if (!entries) throw new ToolError(`Not a readable directory: ${current}`);
      entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (++count > 500) return;
        if (entry.isDirectory()) {
          const skipped = skip.has(entry.name);
          out.push(`${indent}${entry.name}/${skipped ? " (skipped)" : ""}`);
          if (!skipped && level < depth) await visit(path.join(current, entry.name), level + 1, indent + "  ");
        } else {
          out.push(`${indent}${entry.name}`);
        }
      }
    }
    await visit(dir, 1, "");
    if (count > 500) out.push("… (listing truncated at 500 entries)");
    return out.join("\n") || "(empty directory)";
  },
});

export const glob = defineTool({
  name: "glob",
  description:
    "Finds files by glob pattern (e.g. `**/*.ts`, `src/**/test_*.py`). Respects .gitignore. " +
    "Returns paths sorted by modification time (most recent first).",
  schema: z.object({
    pattern: z.string().describe("Glob pattern"),
    path: z.string().optional().describe("Directory to search in (defaults to the root)"),
  }),
  readOnly: true,
  summarize: (i) => i.pattern + (i.path ? ` in ${i.path}` : ""),
  async run(input, ctx) {
    const base = await resolvePath(ctx, input.path ?? ".", "read");
    const pattern = input.pattern.replace(/\\/g, "/");
    const files = (await listFiles(base)).filter((f) => {
      const rel = toPosix(path.relative(base, f));
      return path.matchesGlob(rel, pattern) || (!pattern.includes("/") && path.matchesGlob(path.basename(f), pattern));
    });
    if (!files.length) return "No matches.";
    const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fs.stat(f)).mtimeMs })));
    stats.sort((a, b) => b.t - a.t);
    const shown = stats.slice(0, 300).map((s) => displayPath(ctx.root, s.f));
    return shown.join("\n") + (stats.length > 300 ? `\n… and ${stats.length - 300} more. Narrow the pattern.` : "");
  },
});

export const grep = defineTool({
  name: "grep",
  description:
    "Searches file contents in the project for a pattern (JavaScript regular expression). Respects .gitignore. " +
    "output_mode: `files` (paths only, default), `content` (matching lines with numbers) or `count`.",
  schema: z.object({
    pattern: z.string().describe("Regular expression"),
    path: z.string().optional().describe("File or directory to search (defaults to the root)"),
    glob: z.string().optional().describe("Filter files by glob, e.g. `*.ts` or `src/**/*.py`"),
    output_mode: z.enum(["files", "content", "count"]).optional(),
    case_insensitive: z.boolean().optional(),
    context: z.number().int().min(0).max(10).optional().describe("Lines of context (content mode)"),
    head_limit: z.number().int().min(1).optional().describe("Maximum number of results (default 200)"),
  }),
  readOnly: true,
  summarize: (i) => `/${i.pattern}/` + (i.path ? ` in ${i.path}` : "") + (i.glob ? ` (${i.glob})` : ""),
  async run(input, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, input.case_insensitive ? "i" : "");
    } catch (err) {
      throw new ToolError(`Invalid regular expression: ${(err as Error).message}`);
    }
    const target = await resolvePath(ctx, input.path ?? ".", "read");
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) throw new ToolError(`Does not exist: ${input.path}`);
    let files = stat.isDirectory() ? await listFiles(target) : [target];
    if (input.glob) {
      const g = input.glob.replace(/\\/g, "/");
      files = files.filter((f) => path.matchesGlob(toPosix(path.relative(target, f)), g) || (!g.includes("/") && path.matchesGlob(path.basename(f), g)));
    }
    const mode = input.output_mode ?? "files";
    const limit = input.head_limit ?? 200;
    const ctxLines = input.context ?? 0;
    const results: string[] = [];
    let total = 0;
    for (const file of files) {
      if (ctx.signal.aborted) break;
      const st = await fs.stat(file).catch(() => null);
      if (!st || st.size > 5 * 1024 * 1024) continue;
      if (await isBinary(file).catch(() => true)) continue;
      const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/);
      const hits: number[] = [];
      lines.forEach((line, i) => {
        if (regex.test(line)) hits.push(i);
      });
      if (!hits.length) continue;
      const rel = displayPath(ctx.root, file);
      total += mode === "files" ? 1 : hits.length;
      if (mode === "files") results.push(rel);
      else if (mode === "count") results.push(`${rel}: ${hits.length}`);
      else {
        const shown = new Set<number>();
        for (const h of hits) for (let k = Math.max(0, h - ctxLines); k <= Math.min(lines.length - 1, h + ctxLines); k++) shown.add(k);
        let prev = -2;
        for (const k of [...shown].sort((a, b) => a - b)) {
          if (prev >= 0 && k !== prev + 1) results.push("--");
          results.push(`${rel}:${k + 1}${hits.includes(k) ? ":" : "-"}${lines[k].slice(0, 500)}`);
          prev = k;
        }
      }
      if (results.length >= limit) break;
    }
    if (!results.length) return "No matches.";
    const truncated = results.length > limit ? results.slice(0, limit) : results;
    const note = results.length >= limit ? `\n[Results limited to ${limit}; narrow the search or use head_limit.]` : "";
    return (mode === "files" ? `${total} files:\n` : "") + truncated.join("\n") + note;
  },
});

export const fileTools = [readFile, writeFile, editFile, multiEdit, listDir, glob, grep];
