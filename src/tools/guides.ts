import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { GLOBAL_DIR, projectDir } from "../config.ts";
import { defineTool, ToolError } from "./types.ts";

export interface Guide {
  name: string;
  description: string;
  file: string;
  source: "built-in" | "global" | "project";
}

const BUILT_IN_DIR = fileURLToPath(new URL("../../guides/", import.meta.url));

function parseGuide(file: string): { meta: Record<string, string>; body: string } {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
  }
  return { meta, body: (match ? text.slice(match[0].length) : text).trim() };
}

/**
 * Built-in guides, overridden by global (~/.coding-agent/guides) and then
 * project (.agent/guides) guides with the same name.
 */
export function listGuides(root: string): Guide[] {
  const byName = new Map<string, Guide>();
  const sources: [string, Guide["source"]][] = [
    [BUILT_IN_DIR, "built-in"],
    [path.join(GLOBAL_DIR, "guides"), "global"],
    [path.join(projectDir(root), "guides"), "project"],
  ];
  for (const [dir, source] of sources) {
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }
    for (const f of files.sort()) {
      const file = path.join(dir, f);
      try {
        const { meta, body } = parseGuide(file);
        const name = meta.name || path.basename(f, ".md");
        const description = meta.description || body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 200) || "";
        byName.set(name, { name, description, file, source });
      } catch {
        // unreadable guide: skip it
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const loadGuide = defineTool({
  name: "load_guide",
  description:
    "Loads an expert guide (checklists, standards, pitfalls and verification practices) for a domain or technology. " +
    "The available guides are listed in the system prompt. Load every guide relevant to the task before planning or " +
    "writing code — for example both safety-critical and embedded-systems for flight firmware.",
  schema: z.object({ name: z.string().describe("Guide name, e.g. safety-critical") }),
  readOnly: true,
  summarize: (i) => i.name,
  async run(input, ctx) {
    const guides = listGuides(ctx.root);
    const guide = guides.find((g) => g.name === input.name.trim());
    if (!guide) throw new ToolError(`Unknown guide "${input.name}". Available: ${guides.map((g) => g.name).join(", ")}`);
    return parseGuide(guide.file).body;
  },
});
