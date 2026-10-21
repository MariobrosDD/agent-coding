import { z } from "zod";
import { c } from "../ui.ts";
import { defineTool, ToolError } from "./types.ts";

const NO_USER =
  "No user is available to answer (non-interactive session). Make the most reasonable assumption, " +
  "state it explicitly in your final answer, and continue.";

export const askUser = defineTool({
  name: "ask_user",
  description:
    "Asks the user one or more clarifying questions and waits for the answers. Use it whenever something material is " +
    "unclear: the goal, scope, constraints, acceptance criteria, a technology or design choice with real trade-offs, or " +
    "anything where a wrong guess would waste significant work. Do NOT ask about things you can find out yourself by " +
    "reading the code, docs or environment. Batch related questions in one call (max 4). For each question, offer 2-5 " +
    "concrete options when possible, put your recommended option first and say why in its description; the user can " +
    "always type a different answer.",
  schema: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().describe("A complete, specific question"),
          options: z
            .array(z.object({ label: z.string(), description: z.string().optional() }))
            .max(5)
            .optional()
            .describe("Suggested answers, recommended first"),
          multi_select: z.boolean().optional().describe("Allow choosing several options"),
        }),
      )
      .min(1)
      .max(4),
  }),
  // Not parallel-safe: it holds the terminal while waiting for answers.
  readOnly: false,
  summarize: (i) => i.questions.map((q) => q.question).join(" | "),
  async run(input, ctx) {
    if (!ctx.ui.interactive) return NO_USER;
    const answers: string[] = [];
    for (const [n, q] of input.questions.entries()) {
      ctx.ui.line();
      ctx.ui.line(c.magenta(c.bold(`? ${q.question}`)));
      q.options?.forEach((opt, i) => {
        ctx.ui.line(`  ${c.bold(String(i + 1))}. ${opt.label}${opt.description ? c.dim(` — ${opt.description}`) : ""}`);
      });
      const hint = q.options?.length
        ? q.multi_select
          ? "numbers separated by commas, or type your own answer"
          : "a number, or type your own answer"
        : "type your answer";
      const raw = (await ctx.ui.ask(c.dim(`  (${hint}) › `))).trim();
      if (ctx.signal.aborted) throw new ToolError("Interrupted by the user.");
      let answer = raw;
      if (q.options?.length && /^\d+(\s*,\s*\d+)*$/.test(raw)) {
        const picked = raw.split(",").map((s) => q.options![Number(s.trim()) - 1]?.label).filter(Boolean);
        if (picked.length) answer = picked.join(", ");
      }
      answers.push(`Q${n + 1}: ${q.question}\nA${n + 1}: ${answer || "(no answer — use your best judgment and state the assumption)"}`);
    }
    return answers.join("\n\n");
  },
});

export const presentPlan = defineTool({
  name: "present_plan",
  description:
    "Presents an implementation plan to the user and waits for approval before you change anything. Use it in plan " +
    "mode (required to leave it) and, in any mode, before large, risky or hard-to-reverse changes. The plan should be " +
    "Markdown: the goal, your understanding of the current code, the approach and why, the files to change, risks and " +
    "open assumptions, and how you will verify the result. On approval, plan mode ends and you should implement the plan.",
  schema: z.object({
    plan: z.string().describe("The plan in Markdown"),
  }),
  readOnly: false,
  summarize: (i) => i.plan.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") ?? "",
  async run(input, ctx) {
    if (!ctx.ui.interactive) {
      return ctx.permissions.mode === "plan"
        ? "No user is available to approve the plan (non-interactive session); plan mode stays on. Give the plan as your final answer."
        : "No user is available to approve the plan; proceed with it carefully and report what you did.";
    }
    ctx.ui.line();
    ctx.ui.line(c.cyan(c.bold("━━ Proposed plan ━━")));
    ctx.ui.line(input.plan.trim());
    ctx.ui.line(c.cyan(c.bold("━━━━━━━━━━━━━━━━━━━")));
    const answer = (await ctx.ui.ask(`Approve? ${c.bold("y")}es, implement / ${c.bold("n")}o, keep planning / or type changes › `)).trim();
    if (ctx.signal.aborted) throw new ToolError("Interrupted by the user.");
    const lower = answer.toLowerCase();
    if (["y", "yes"].includes(lower)) {
      const mode = ctx.permissions.exitPlanMode();
      ctx.ui.line(c.green(`  ✔ plan approved · permissions: ${mode}`));
      return `The user approved the plan. Permission mode is now "${mode}". Implement it now, tracking the steps with todo_write, and verify as you go.`;
    }
    if (!answer || ["n", "no"].includes(lower)) {
      return "The user did not approve the plan. Ask what they would like to change (ask_user) before revising it.";
    }
    return `The user did not approve the plan yet and asked for these changes:\n${answer}\n\nRevise the plan accordingly (investigate further if needed) and present it again.`;
  },
});

export const interactionTools = [askUser, presentPlan];
