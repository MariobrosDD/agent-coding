import type Anthropic from "@anthropic-ai/sdk";

/** USD per million tokens. Cache writes are billed at 1.25x input (5-minute TTL). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export class CostTracker {
  input = 0;
  output = 0;
  cacheRead = 0;
  cacheWrite = 0;
  usd = 0;
  requests = 0;
  unknownModels = new Set<string>();

  add(model: string, usage: Anthropic.Beta.BetaUsage): void {
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    this.input += input;
    this.output += output;
    this.cacheRead += cacheRead;
    this.cacheWrite += cacheWrite;
    this.requests++;
    const price = PRICES[model];
    if (!price) {
      this.unknownModels.add(model);
      return;
    }
    this.usd += (input * price.input + output * price.output + cacheRead * price.cacheRead + cacheWrite * price.input * 1.25) / 1e6;
  }

  summary(): string {
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    const cacheShare = this.input + this.cacheRead + this.cacheWrite ? Math.round((100 * this.cacheRead) / (this.input + this.cacheRead + this.cacheWrite)) : 0;
    const unknown = this.unknownModels.size ? ` (no pricing for ${[...this.unknownModels].join(", ")})` : "";
    return `≈ $${this.usd.toFixed(4)}${unknown} · ${this.requests} requests · input ${k(this.input)} · cache read ${k(this.cacheRead)} (${cacheShare}%) · cache write ${k(this.cacheWrite)} · output ${k(this.output)}`;
  }
}
