import Anthropic from "@anthropic-ai/sdk";
import { hasApiKey } from "@/lib/anthropic";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export type WebItem = {
  title: string;
  url: string;
  summary: string;
  modules: string[];
  relevance: "high" | "medium" | "low";
  relevanceReason: string;
};

export type WebResult = { items: WebItem[]; costCents: number };

function splitDomains(csv?: string | null): string[] {
  return (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// A web-research agent: uses Claude's built-in web search to gather recent
// items about a topic, each scored for relevance. Returns [] when there's no
// API key. Web search is a billed server tool (a few pennies per run).
export async function runWebResearch(input: {
  query: string;
  instructions?: string;
  moduleNames: string[];
  maxItems?: number;
  lookbackDays?: number;
  allowedDomains?: string | null;
  blockedDomains?: string | null;
}): Promise<WebResult> {
  if (!hasApiKey()) return { items: [], costCents: 0 };

  const client = new Anthropic();
  const max = input.maxItems ?? 6;
  const lookback = input.lookbackDays ?? 30;
  const steer = input.instructions?.trim()
    ? `\n\nStanding instructions from the firm (follow closely):\n${input.instructions.trim()}`
    : "";

  const system =
    "You are a research agent for an EPM (CCH Tagetik) consultancy. Use web " +
    `search to find the most relevant items about the topic, preferring ones ` +
    `from roughly the last ${lookback} days. ` +
    `Return ONLY valid JSON: an array of up to ${max} objects of the form ` +
    '{"title": string, "url": string, "summary": string, "modules": string[], ' +
    '"relevance": "high"|"medium"|"low", "relevanceReason": string}. ' +
    "summary is 2-3 sentences on what it is and why it matters to clients. " +
    "relevance reflects how important this is for the firm to act on, with a " +
    "one-line reason. modules must be chosen only from this list: " +
    `${input.moduleNames.join(", ")}.` +
    steer;

  // Built-in web search server tool (runs on Anthropic's side).
  const searchTool: Record<string, unknown> = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: 5,
  };
  const allow = splitDomains(input.allowedDomains);
  const block = splitDomains(input.blockedDomains);
  if (allow.length) searchTool.allowed_domains = allow;
  else if (block.length) searchTool.blocked_domains = block;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system,
    tools: [searchTool] as unknown as Anthropic.Tool[],
    messages: [{ role: "user", content: `Topic: ${input.query}` }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const raw = parseJsonArray(text);
  const allowed = new Set(input.moduleNames.map((m) => m.toLowerCase()));
  const items: WebItem[] = raw
    .filter((x) => x && typeof x.url === "string" && typeof x.title === "string")
    .map((x) => ({
      title: String(x.title).slice(0, 300),
      url: String(x.url),
      summary: typeof x.summary === "string" ? x.summary : "",
      modules: Array.isArray(x.modules)
        ? x.modules
            .map((m: unknown) => String(m))
            .filter((m: string) => allowed.has(m.toLowerCase()))
        : [],
      relevance: normaliseRelevance(x.relevance),
      relevanceReason:
        typeof x.relevanceReason === "string" ? x.relevanceReason : "",
    }))
    .slice(0, max);

  return { items, costCents: estimateCostCents(response) };
}

// Dig deeper on a single topic: a focused web search returning richer prose
// (not a list), used to enrich an existing finding.
export async function webDeepDive(input: {
  topic: string;
  note?: string;
  instructions?: string;
}): Promise<{ text: string; costCents: number }> {
  if (!hasApiKey()) return { text: "", costCents: 0 };

  const client = new Anthropic();
  const steer = input.instructions?.trim()
    ? `\n\nFirm context:\n${input.instructions.trim()}`
    : "";
  const system =
    "You are a research agent for an EPM (CCH Tagetik) consultancy. Use web " +
    "search to dig deeper into the topic and write a richer briefing (5-8 " +
    "sentences) focused on the requested angle. Plain text, no JSON, no lists " +
    "of links." +
    steer;
  const user =
    `Topic: ${input.topic}\n` +
    `Focus: ${input.note?.trim() || "general deeper detail and recent developments"}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 4 },
    ] as unknown as Anthropic.Tool[],
    messages: [{ role: "user", content: user }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return { text, costCents: estimateCostCents(response) };
}

function normaliseRelevance(v: unknown): "high" | "medium" | "low" {
  const s = String(v ?? "").toLowerCase();
  if (s === "high") return "high";
  if (s === "low") return "low";
  return "medium";
}

// Rough spend estimate: Sonnet token rates ($2/$10 per 1M) + ~1c per web search.
function estimateCostCents(response: Anthropic.Message): number {
  const u = response.usage;
  const inTok = u?.input_tokens ?? 0;
  const outTok = u?.output_tokens ?? 0;
  const dollars = (inTok * 2 + outTok * 10) / 1_000_000;
  const searches = response.content.filter(
    (b) => b.type === "web_search_tool_result",
  ).length;
  return Math.max(1, Math.round(dollars * 100) + searches);
}

function parseJsonArray(text: string): any[] {
  try {
    const direct = JSON.parse(text);
    return Array.isArray(direct) ? direct : [];
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const arr = JSON.parse(match[0]);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}
