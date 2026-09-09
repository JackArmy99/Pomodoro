import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";

// The full-quality model: whatever ANTHROPIC_MODEL is set to, else Sonnet 5.
const FULL_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
// The cheap model used while tuning. Haiku 4.5 is the cheapest sensible Claude
// model that still drives web search — half Sonnet's token price.
const TEST_MODEL = "claude-haiku-4-5";

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Is the cheap "Test mode" switch on? Persisted as a Setting so the toggle on
// the Agents page is authoritative across every run. Defaults to off.
export async function isTestMode(): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "test_mode" } });
    return row?.value === "on";
  } catch {
    return false;
  }
}

// Resolve the model + web-search cap for one research run, honouring Test mode.
// Test on → Haiku, 2 searches (~2–3p/run); off → the full model, 5 searches.
export async function resolveRunModel(): Promise<{
  model: string;
  maxSearches: number;
}> {
  return (await isTestMode())
    ? { model: TEST_MODEL, maxSearches: 2 }
    : { model: FULL_MODEL, maxSearches: 5 };
}

export type Summary = {
  summary: string;
  suggestedModules: string[];
  relevance: "high" | "medium" | "low";
  relevanceReason: string;
};

// Summarise a research item and suggest which of our modules it relates to.
// Returns null if there's no API key (the app still works — items just stay raw).
export async function summariseItem(input: {
  title: string;
  content: string;
  moduleNames: string[];
  instructions?: string; // the firm's own steering, injected verbatim
}): Promise<Summary | null> {
  if (!hasApiKey()) return null;

  const client = new Anthropic();
  const { model } = await resolveRunModel();
  const moduleList = input.moduleNames.join(", ");

  const steer = input.instructions?.trim()
    ? `\n\nStanding instructions from the firm (follow these closely):\n${input.instructions.trim()}`
    : "";

  const system =
    "You help an EPM (CCH Tagetik) consultancy triage vendor news. " +
    "Given a news/article item, write a tight 2-3 sentence summary focused on " +
    "what changed and why it matters to clients, pick which of the firm's " +
    "modules it relates to (only from the provided list), and score how " +
    "important it is for the firm to act on. " +
    'Respond with ONLY valid JSON: {"summary": string, "modules": string[], ' +
    '"relevance": "high"|"medium"|"low", "relevanceReason": string}.' +
    steer;

  const user =
    `Firm's modules: ${moduleList}\n\n` +
    `Title: ${input.title}\n\n` +
    `Content:\n${input.content.slice(0, 8000)}`;

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const parsed = parseJson(text);
  if (!parsed)
    return {
      summary: text.slice(0, 600),
      suggestedModules: [],
      relevance: "medium",
      relevanceReason: "",
    };

  // Keep only suggested modules that actually exist in our catalogue.
  const allowed = new Set(input.moduleNames.map((m) => m.toLowerCase()));
  const suggested = Array.isArray(parsed.modules)
    ? parsed.modules
        .map((m: unknown) => String(m))
        .filter((m: string) => allowed.has(m.toLowerCase()))
    : [];

  const rel = String((parsed as { relevance?: unknown }).relevance ?? "")
    .toLowerCase();

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : text,
    suggestedModules: suggested,
    relevance: rel === "high" ? "high" : rel === "low" ? "low" : "medium",
    relevanceReason:
      typeof (parsed as { relevanceReason?: unknown }).relevanceReason ===
      "string"
        ? (parsed as { relevanceReason: string }).relevanceReason
        : "",
  };
}

// Defensive JSON parse — the model may wrap JSON in prose or code fences.
function parseJson(text: string): { summary?: unknown; modules?: unknown } | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
