import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ToolError, type ToolContext } from "./types.ts";

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function displayPath(root: string, file: string): string {
  return isInside(root, file) ? path.relative(root, file) || "." : file;
}

/** Real path of `target`, or of its closest existing parent when it does not exist yet. */
async function canonical(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    let dir = path.dirname(target);
    while (dir !== path.dirname(dir)) {
      try {
        return path.join(await fs.realpath(dir), path.relative(dir, target));
      } catch {
        dir = path.dirname(dir);
      }
    }
    return target;
  }
}

const rootCache = new Map<string, Promise<string>>();
function canonicalRoot(root: string): Promise<string> {
  let real = rootCache.get(root);
  if (!real) rootCache.set(root, (real = canonical(root)));
  return real;
}

/**
 * Resolves a model-supplied path. Paths outside the project root need the
 * user's approval; writes into .git are refused.
 */
export async function resolvePath(ctx: ToolContext, input: string, access: "read" | "write"): Promise<string> {
  if (!input?.trim()) throw new ToolError("Missing path.");
  const target = path.resolve(ctx.root, input.trim());
  const real = await canonical(target);
  if (access === "write" && real.split(path.sep).includes(".git")) {
    throw new ToolError("Writing inside .git is not allowed; use git commands instead.");
  }
  // Compare canonical forms on both sides: symlinks, junctions and Windows 8.3
  // short names (C:\Users\MARIO~1) would otherwise make project files look outside.
  if (!isInside(await canonicalRoot(ctx.root), real)) {
    const verdict = await ctx.permissions.request({
      kind: "outside",
      key: path.dirname(real),
      title: `${access === "write" ? "Write" : "Read"} outside the project: ${real}`,
    });
    if (!verdict.ok) throw new ToolError(verdict.reason);
  }
  return target;
}

const IGNORED_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache", "coverage",
  "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", "target", "obj",
  ".idea", ".vs", ".gradle", "vendor", ".agent",
]);

function gitFiles(dir: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: dir, maxBuffer: 256 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout.split("\0").filter(Boolean).map((f) => path.join(dir, f)));
      },
    );
  });
}

async function walk(dir: string, out: string[], limit: number): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= limit) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) await walk(full, out, limit);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

/** Project files under `dir`, honoring .gitignore when inside a git repository. */
export async function listFiles(dir: string, limit = 200_000): Promise<string[]> {
  const fromGit = await gitFiles(dir);
  if (fromGit) {
    // git also lists deleted-but-tracked files; drop the ones that no longer exist.
    const existing = await Promise.all(fromGit.map(async (f) => ((await fs.stat(f).catch(() => null))?.isFile() ? f : null)));
    return existing.filter((f): f is string => f !== null).slice(0, limit);
  }
  const out: string[] = [];
  await walk(dir, out, limit);
  return out;
}

export async function isBinary(file: string): Promise<boolean> {
  const handle = await fs.open(file, "r");
  try {
    const buf = Buffer.alloc(8000);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}
