import Parser from "rss-parser";
import { prisma } from "@/lib/db";
import { summariseItem, hasApiKey } from "@/lib/anthropic";

const parser = new Parser({ timeout: 15000 });

// The firm's global "what to look for" steering, if set.
async function globalInstructions(): Promise<string> {
  const s = await prisma.setting.findUnique({
    where: { key: "research_instructions" },
  });
  return s?.value ?? "";
}

// Run the AI summariser on one finding and attach suggested modules.
// No-op (leaves the finding raw) when there's no API key.
// `sourceInstructions` adds steering specific to the source it came from.
export async function processFinding(
  findingId: string,
  sourceInstructions?: string,
): Promise<void> {
  if (!hasApiKey()) return;

  const finding = await prisma.finding.findUnique({ where: { id: findingId } });
  if (!finding) return;

  const [modules, global] = await Promise.all([
    prisma.module.findMany({ select: { id: true, name: true } }),
    globalInstructions(),
  ]);

  const instructions = [global, sourceInstructions]
    .filter((s) => s && s.trim())
    .join("\n\n");

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
      data: { summary: result.summary, aiProcessed: true },
    }),
    prisma.findingModule.deleteMany({ where: { findingId } }),
    ...moduleIds.map((moduleId) =>
      prisma.findingModule.create({ data: { findingId, moduleId } }),
    ),
  ]);
}

// Fetch one RSS source: pull new items into the inbox, then summarise them.
// Returns the number of new findings created.
export async function fetchSourceById(sourceId: string): Promise<number> {
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source || !source.active) return 0;

  let feed;
  try {
    feed = await parser.parseURL(source.url);
  } catch {
    // Unreachable/invalid feed — record the attempt and move on.
    await prisma.source.update({
      where: { id: sourceId },
      data: { lastFetchedAt: new Date() },
    });
    return 0;
  }

  const createdIds: string[] = [];
  for (const item of feed.items ?? []) {
    const externalId = item.guid || item.link || item.title;
    if (!externalId) continue;

    const exists = await prisma.finding.findUnique({ where: { externalId } });
    if (exists) continue;

    const published = item.isoDate ? new Date(item.isoDate) : null;
    const finding = await prisma.finding.create({
      data: {
        title: item.title?.slice(0, 300) || "(untitled)",
        rawContent: (item.contentSnippet || item.content || "").slice(0, 8000),
        sourceUrl: item.link ?? source.url,
        sourceType: "rss",
        externalId,
        publishedAt: published,
      },
    });
    createdIds.push(finding.id);
  }

  await prisma.source.update({
    where: { id: sourceId },
    data: { lastFetchedAt: new Date() },
  });

  // Summarise the new ones (skipped automatically if no API key).
  for (const id of createdIds) {
    await processFinding(id, source.instructions ?? undefined);
  }

  return createdIds.length;
}

export async function fetchAllActiveSources(): Promise<number> {
  const sources = await prisma.source.findMany({ where: { active: true } });
  let total = 0;
  for (const s of sources) {
    total += await fetchSourceById(s.id);
  }
  return total;
}
