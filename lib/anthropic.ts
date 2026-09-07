import Anthropic from "@anthropic-ai/sdk";

// Default summariser model — cheap and good for this bulk task. Override with
// ANTHROPIC_MODEL in .env if you want (e.g. claude-opus-5 for sharper drafts).
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type Summary = {
  summary: string;
  suggestedModules: string[];
};

// Summarise a research item and suggest which of our modules it relates to.
// Returns null if there's no API key (the app still works — items just stay raw).
export async function summariseItem(input: {
  title: string;
  content: string;
  moduleNames: string[];
}): Promise<Summary | null> {
  if (!hasApiKey()) return null;

  const client = new Anthropic();
  const moduleList = input.moduleNames.join(", ");

  const system =
    "You help an EPM (CCH Tagetik) consultancy triage vendor news. " +
    "Given a news/article item, write a tight 2-3 sentence summary focused on " +
    "what changed and why it matters to clients, and pick which of the firm's " +
    "modules it relates to. Only choose modules from the provided list. " +
    'Respond with ONLY valid JSON: {"summary": string, "modules": string[]}.';

  const user =
    `Firm's modules: ${moduleList}\n\n` +
    `Title: ${input.title}\n\n` +
    `Content:\n${input.content.slice(0, 8000)}`;

  const response = await client.messages.create({
    model: MODEL,
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
  if (!parsed) return { summary: text.slice(0, 600), suggestedModules: [] };

  // Keep only suggested modules that actually exist in our catalogue.
  const allowed = new Set(input.moduleNames.map((m) => m.toLowerCase()));
  const suggested = Array.isArray(parsed.modules)
    ? parsed.modules
        .map((m: unknown) => String(m))
        .filter((m: string) => allowed.has(m.toLowerCase()))
    : [];

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : text,
    suggestedModules: suggested,
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
