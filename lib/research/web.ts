import Anthropic from "@anthropic-ai/sdk";
import { hasApiKey } from "@/lib/anthropic";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export type WebItem = {
  title: string;
  url: string;
  summary: string;
  modules: string[];
};

// A web-research agent: uses Claude's built-in web search to gather recent
// items about a topic and return them as structured findings. Returns [] when
// there's no API key. Note: web search is a billed server tool (a few pennies
// per run) on top of the token cost.
export async function runWebResearch(input: {
  query: string;
  instructions?: string;
  moduleNames: string[];
  maxItems?: number;
}): Promise<WebItem[]> {
  if (!hasApiKey()) return [];

  const client = new Anthropic();
  const max = input.maxItems ?? 5;
  const steer = input.instructions?.trim()
    ? `\n\nStanding instructions from the firm (follow closely):\n${input.instructions.trim()}`
    : "";

  const system =
    "You are a research agent for an EPM (CCH Tagetik) consultancy. Use web " +
    "search to find the most relevant RECENT items about the given topic. " +
    `Return ONLY valid JSON: an array of up to ${max} objects of the form ` +
    '{"title": string, "url": string, "summary": string, "modules": string[]}. ' +
    "summary is 2-3 sentences on what it is and why it matters to clients. " +
    `modules must be chosen only from this list: ${input.moduleNames.join(", ")}.` +
    steer;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    // Built-in web search server tool (runs on Anthropic's side).
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 5 },
    ] as unknown as Anthropic.Tool[],
    messages: [{ role: "user", content: `Topic: ${input.query}` }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const items = parseJsonArray(text);
  const allowed = new Set(input.moduleNames.map((m) => m.toLowerCase()));

  return items
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
    }))
    .slice(0, max);
}

// Defensive parse — pull the first JSON array out of the model's text.
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
