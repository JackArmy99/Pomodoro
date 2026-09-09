import Parser from "rss-parser";
import { prisma } from "@/lib/db";
import { summariseItem, hasApiKey } from "@/lib/anthropic";
import { runWebResearch, webDeepDive, type WebItem } from "@/lib/research/web";

const parser = new Parser({ timeout: 15000 });

export type RunTally = {
  created: number;
  high: number;
  med: number;
  low: number;
  costCents: number;
};

const emptyTally = (): RunTally => ({
  created: 0,
  high: 0,
  med: 0,
  low: 0,
  costCents: 0,
});

function tallyRelevance(t: RunTally, relevance: string) {
  t.created += 1;
  if (relevance === "high") t.high += 1;
  else if (relevance === "low") t.low += 1;
  else t.med += 1;
}

// NOTE: steering now lives on each Agent's `briefing` (the old global
// `research_instructions` Setting was retired — it was being injected twice).

// Run the AI summariser on one finding: summary, modules, relevance. Also
// stamps the agent. No-op (leaves the finding raw) when there's no API key.
export async function processFinding(
  findingId: string,
  opts?: { instructions?: string; agentId?: string },
): Promise<void> {
  if (!hasApiKey()) return;

  const finding = await prisma.finding.findUnique({ where: { id: findingId } });
  if (!finding) return;

  const modules = await prisma.module.findMany({
    select: { id: true, name: true },
  });

  const instructions = (opts?.instructions ?? "").trim();

  const result = await summariseItem({
    title: finding.title,
    content: finding.rawContent || finding.summary || finding.title,
    moduleNames: modules.map((m) => m.name),
    instructions,
  });
  if (!result) return;

  const byName = new Map(modules.map((m) => [m.name.toLowerCase(), m.id]));
  const moduleIds = result.suggestedModules
    .map((n) => byName.get(n.toLowerCase()))
    .filter((id): id is string => Boolean(id));

  await prisma.$transaction([
    prisma.finding.update({
      where: { id: findingId },
      data: {
        summary: result.summary,
        relevance: result.relevance,
        relevanceReason: result.relevanceReason,
        aiProcessed: true,
        ...(opts?.agentId ? { agentId: opts.agentId } : {}),
      },
    }),
    prisma.findingModule.deleteMany({ where: { findingId } }),
    ...moduleIds.map((moduleId) =>
      prisma.findingModule.create({ data: { findingId, moduleId } }),
    ),
  ]);
}

// Turn web-research items into inbox findings (deduped, module + relevance
// tagged, attributed to an agent). Returns a relevance tally.
export async function createWebFindings(
  items: WebItem[],
  agentId?: string | null,
): Promise<RunTally> {
  const modules = await prisma.module.findMany({
    select: { id: true, name: true },
  });
  const byName = new Map(modules.map((m) => [m.name.toLowerCase(), m.id]));
  const tally = emptyTally();

  for (const item of items) {
    const exists = await prisma.finding.findUnique({
      where: { externalId: item.url },
    });
    if (exists) continue;

    const moduleIds = item.modules
      .map((n) => byName.get(n.toLowerCase()))
      .filter((id): id is string => Boolean(id));

    await prisma.finding.create({
      data: {
        title: item.title,
        summary: item.summary,
        rawContent: item.summary,
        sourceUrl: item.url,
        sourceType: "web",
        externalId: item.url,
        aiProcessed: true,
        relevance: item.relevance,
        relevanceReason: item.relevanceReason,
        agentId: agentId ?? null,
        modules: { create: moduleIds.map((moduleId) => ({ moduleId })) },
      },
    });
    tallyRelevance(tally, item.relevance);
  }
  return tally;
}

type AgentCtx = {
  id: string;
  name: string;
  mission: string;
  briefing: string;
  maxItems: number;
  lookbackDays: number;
  allowedDomains: string | null;
  blockedDomains: string | null;
};

// Build a "signals from past triage" block from what the user has approved
// (valuable) vs dismissed (noise) for this agent, so runs self-correct.
async function agentFeedback(agentId: string): Promise<string> {
  const [approved, dismissed] = await Promise.all([
    prisma.finding.findMany({
      where: { agentId, status: "approved" },
      select: { title: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.finding.findMany({
      where: { agentId, status: "dismissed" },
      select: { title: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const parts: string[] = [];
  if (approved.length)
    parts.push(
      "Examples the team found VALUABLE (favour similar):\n- " +
        approved.map((f) => f.title).join("\n- "),
    );
  if (dismissed.length)
    parts.push(
      "Examples marked NOT USEFUL (avoid similar):\n- " +
        dismissed.map((f) => f.title).join("\n- "),
    );
  return parts.length ? "Signals from past triage:\n" + parts.join("\n\n") : "";
}

// Run a Finder agent: a briefing-driven web search plus any pinned sources.
// Returns the combined relevance tally + estimated cost.
export async function runFinderAgent(agent: AgentCtx): Promise<RunTally> {
  const [modules, sources, briefs, feedback] = await Promise.all([
    prisma.module.findMany({ select: { name: true } }),
    prisma.source.findMany({ where: { agentId: agent.id, active: true } }),
    prisma.researchBrief.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: "asc" },
    }),
    agentFeedback(agent.id),
  ]);
  const moduleNames = modules.map((m) => m.name);
  const total = emptyTally();

  // `topic` is what actually gets searched, so it must be substantive —
  // `withBriefing` avoids repeating the briefing when it IS the topic.
  const doWeb = async (
    topic: string,
    opts?: { withBriefing?: boolean; extra?: string | null },
  ) => {
    const instructions = [
      opts?.withBriefing ? agent.briefing : null,
      feedback,
      opts?.extra,
    ]
      .filter((s) => s && s.trim())
      .join("\n\n");
    const { items, costCents } = await runWebResearch({
      query: topic,
      instructions,
      moduleNames,
      maxItems: agent.maxItems,
      lookbackDays: agent.lookbackDays,
      allowedDomains: agent.allowedDomains,
      blockedDomains: agent.blockedDomains,
    });
    total.costCents += costCents;
    const t = await createWebFindings(items, agent.id);
    total.created += t.created;
    total.high += t.high;
    total.med += t.med;
    total.low += t.low;
  };

  // 1) The briefing IS the research topic (falling back to mission/name).
  const briefingTopic = (
    agent.briefing?.trim() ||
    agent.mission?.trim() ||
    agent.name
  ).slice(0, 1500);
  await doWeb(briefingTopic, { withBriefing: false });

  // 2) Any pinned sources: web topics search their query; rss feeds are fetched.
  for (const s of sources) {
    if (s.type === "web") {
      await doWeb(s.query || s.name, {
        withBriefing: true,
        extra: s.instructions,
      });
    } else {
      // Count RSS items by their scored relevance so the breakdown adds up.
      const ids = await fetchRssFeed(s);
      if (ids.length) {
        const scored = await prisma.finding.findMany({
          where: { id: { in: ids } },
          select: { relevance: true },
        });
        for (const f of scored) tallyRelevance(total, f.relevance);
      }
    }
  }

  // 3) Any attached briefs (uploaded PDF/Word or typed): the brief's own text
  //    is the topic, steered by the agent's briefing.
  for (const b of briefs) {
    await doWeb((b.content.trim() || b.name).slice(0, 1500), {
      withBriefing: true,
      extra: `Brief: ${b.name}`,
    });
    await prisma.researchBrief.update({
      where: { id: b.id },
      data: { lastRunAt: new Date() },
    });
  }

  return total;
}

// Fetch one RSS feed's new items into the inbox, tagged with its agent.
async function fetchRssFeed(source: {
  id: string;
  url: string;
  instructions: string | null;
  agentId: string | null;
}): Promise<string[]> {
  let feed;
  try {
    feed = await parser.parseURL(source.url);
  } catch {
    await prisma.source.update({
      where: { id: source.id },
      data: { lastFetchedAt: new Date() },
    });
    return [];
  }

  const createdIds: string[] = [];
  for (const item of feed.items ?? []) {
    const externalId = item.guid || item.link || item.title;
    if (!externalId) continue;
    const exists = await prisma.finding.findUnique({ where: { externalId } });
    if (exists) continue;

    const finding = await prisma.finding.create({
      data: {
        title: item.title?.slice(0, 300) || "(untitled)",
        rawContent: (item.contentSnippet || item.content || "").slice(0, 8000),
        sourceUrl: item.link ?? source.url,
        sourceType: "rss",
        externalId,
        publishedAt: item.isoDate ? new Date(item.isoDate) : null,
        agentId: source.agentId ?? null,
      },
    });
    createdIds.push(finding.id);
  }

  await prisma.source.update({
    where: { id: source.id },
    data: { lastFetchedAt: new Date() },
  });

  for (const id of createdIds) {
    await processFinding(id, {
      instructions: source.instructions ?? undefined,
      agentId: source.agentId ?? undefined,
    });
  }
  return createdIds;
}

// Web research against a full brief (uploaded/typed), attributed to an agent.
// The brief's text is the topic — that's what should actually be searched.
export async function researchFromBrief(
  name: string,
  content: string,
  opts?: { agentId?: string | null; agent?: AgentCtx | null },
): Promise<RunTally> {
  const modules = await prisma.module.findMany({ select: { name: true } });
  const a = opts?.agent;
  const instructions = [a?.briefing, `Brief: ${name}`]
    .filter((s) => s && s.trim())
    .join("\n\n");

  const { items, costCents } = await runWebResearch({
    query: content.slice(0, 1500) || name,
    instructions,
    moduleNames: modules.map((m) => m.name),
    maxItems: a?.maxItems ?? 8,
    lookbackDays: a?.lookbackDays,
    allowedDomains: a?.allowedDomains,
    blockedDomains: a?.blockedDomains,
  });

  const tally = await createWebFindings(items, opts?.agentId ?? null);
  tally.costCents += costCents;
  return tally;
}

// Dig deeper on an existing finding: research more (optionally steered by a
// note) and append the extra detail to the finding's summary, in place.
export async function deepenFinding(
  findingId: string,
  note?: string,
): Promise<void> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    include: { agent: { select: { briefing: true } } },
  });
  if (!finding) return;

  const { text } = await webDeepDive({
    topic: `${finding.title}. ${finding.summary}`.slice(0, 500),
    note,
    instructions: finding.agent?.briefing ?? undefined,
  });
  if (!text) return;

  const stamp = note ? `Dig deeper (${note})` : "Dig deeper";
  const summary = `${finding.summary}\n\n— ${stamp} —\n${text}`.trim();
  await prisma.finding.update({
    where: { id: findingId },
    data: { summary },
  });
}

// One-off ad-hoc research (no saved agent, so no standing briefing to apply).
export async function researchAdHoc(query: string): Promise<RunTally> {
  const modules = await prisma.module.findMany({ select: { name: true } });
  const { items, costCents } = await runWebResearch({
    query,
    moduleNames: modules.map((m) => m.name),
    maxItems: 6,
  });
  const tally = await createWebFindings(items, null);
  tally.costCents += costCents;
  return tally;
}
