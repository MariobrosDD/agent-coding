import { c } from "./ui.ts";

type Op = { type: " " | "-" | "+"; line: string };

/** Line diff via LCS. Falls back to a whole-block replace for very large inputs. */
function diffLines(a: string[], b: string[]): Op[] {
  if (a.length * b.length > 4_000_000) {
    return [...a.map((line) => ({ type: "-" as const, line })), ...b.map((line) => ({ type: "+" as const, line }))];
  }
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: " ", line: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "-", line: a[i++] });
    } else {
      ops.push({ type: "+", line: b[j++] });
    }
  }
  while (i < n) ops.push({ type: "-", line: a[i++] });
  while (j < m) ops.push({ type: "+", line: b[j++] });
  return ops;
}

/** Colored unified-style diff with `context` lines around each change. */
export function renderDiff(before: string, after: string, context = 3, maxLines = 80): string {
  const ops = diffLines(before.replace(/\r\n/g, "\n").split("\n"), after.replace(/\r\n/g, "\n").split("\n"));
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type === " ") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: string[] = [];
  let oldNo = 1;
  let newNo = 1;
  let skipped = false;
  ops.forEach((op, idx) => {
    if (keep[idx]) {
      if (skipped && out.length) out.push(c.dim("   ⋮"));
      skipped = false;
      if (op.type === "-") out.push(c.red(`${String(oldNo).padStart(4)} - ${op.line}`));
      else if (op.type === "+") out.push(c.green(`${String(newNo).padStart(4)} + ${op.line}`));
      else out.push(c.dim(`${String(newNo).padStart(4)}   ${op.line}`));
    } else {
      skipped = true;
    }
    if (op.type !== "+") oldNo++;
    if (op.type !== "-") newNo++;
  });
  if (out.length > maxLines) {
    return [...out.slice(0, maxLines), c.dim(`   … (${out.length - maxLines} more lines)`)].join("\n");
  }
  return out.join("\n");
}

export function diffStats(before: string, after: string): { added: number; removed: number } {
  const ops = diffLines(before.replace(/\r\n/g, "\n").split("\n"), after.replace(/\r\n/g, "\n").split("\n"));
  return {
    added: ops.filter((o) => o.type === "+").length,
    removed: ops.filter((o) => o.type === "-").length,
  };
}
