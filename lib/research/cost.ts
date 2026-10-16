// Model pricing, in one place, used by both the Finder and the video pipeline.
//
// Costs are held in **micro-USD** (millionths of a dollar). A single summarise
// call can cost a fraction of a penny, and rounding that to pennies would
// record every run as "0" — which is how a per-job budget quietly becomes
// meaningless.

export type Rates = { inRate: number; outRate: number }; // $ per million tokens

// Haiku 5.5 has two rate cards, chosen by how long the prompt is.
const HAIKU_55_LONG_PROMPT = 100_000;

export function ratesFor(model: string, inputTokens = 0): Rates {
  // Haiku 5.5 MUST be matched before the generic "haiku" test below. That test
  // prices Haiku 4.5 at $1/$5; letting 5.5 fall through to it would show every
  // test-mode run at about ten times what it actually cost.
  if (model.includes("haiku-5")) {
    return inputTokens > HAIKU_55_LONG_PROMPT
      ? { inRate: 0.5, outRate: 2.5 }
      : { inRate: 0.1, outRate: 0.5 };
  }
  if (model.includes("opus")) return { inRate: 5, outRate: 25 };
  if (model.includes("haiku")) return { inRate: 1, outRate: 5 };
  if (model.includes("fable") || model.includes("mythos"))
    return { inRate: 10, outRate: 50 };
  return { inRate: 2, outRate: 10 }; // sonnet
}

export function microUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const { inRate, outRate } = ratesFor(model, inputTokens);
  return Math.round(inputTokens * inRate + outputTokens * outRate);
}

// For display: "0.7p", "2p". Uses a rough USD→GBP rate — this is a running
// estimate to keep testing honest, not an invoice.
const USD_TO_GBP = 0.79;

export function formatPence(totalMicroUsd: number): string {
  const pence = (totalMicroUsd / 1_000_000) * USD_TO_GBP * 100;
  if (pence === 0) return "0p";
  if (pence < 1) return `${pence.toFixed(1)}p`;
  return `${Math.round(pence)}p`;
}
