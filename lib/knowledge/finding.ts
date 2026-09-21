import type { PrismaClient } from "@prisma/client";
import { CLEARS_VERIFICATION } from "@/lib/research/revision";

// One pending inbox item per knowledge source, whatever the source is.
//
// Lifted out of the video pipeline unchanged, because a webinar page needs
// exactly the same behaviour: the unique `knowledgeSourceId` makes a second run
// UPDATE the existing item rather than filling the inbox with duplicates, and
// re-analysing clears any verification tick — what a reviewer read is no longer
// what is on screen.
//
// Everything lands `pending` and unverified. Nothing reaches a client until a
// human ticks it; that gate is the whole point and is not weakened here.

export type FindingInput = {
  title: string;
  summary: string; // what the inbox shows
  rawContent: string; // the fuller text behind it
  sourceUrl: string;
  sourceType: string; // "video" | "portal" | …
  sourceBody?: string | null; // the issuing body/site
  effectiveDate?: Date | null;
  relevance: string;
  relevanceReason?: string | null;
  moduleNames: string[];
};

export async function upsertSourceFinding(
  prisma: PrismaClient,
  sourceId: string,
  input: FindingInput,
): Promise<void> {
  const named = input.moduleNames.length
    ? await prisma.module.findMany({
        where: { name: { in: input.moduleNames } },
        select: { id: true },
      })
    : [];

  const existing = await prisma.finding.findUnique({
    where: { knowledgeSourceId: sourceId },
    select: { id: true },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.finding.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          summary: input.summary,
          relevance: input.relevance,
          relevanceReason: input.relevanceReason ?? null,
          sourceBody: input.sourceBody ?? null,
          effectiveDate: input.effectiveDate ?? null,
          ...CLEARS_VERIFICATION,
        },
      }),
      prisma.findingModule.deleteMany({ where: { findingId: existing.id } }),
      ...named.map((m) =>
        prisma.findingModule.create({
          data: { findingId: existing.id, moduleId: m.id },
        }),
      ),
    ]);
    return;
  }

  await prisma.finding.create({
    data: {
      title: input.title,
      summary: input.summary,
      rawContent: input.rawContent,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      sourceBody: input.sourceBody ?? null,
      effectiveDate: input.effectiveDate ?? null,
      status: "pending",
      aiProcessed: true,
      relevance: input.relevance,
      relevanceReason: input.relevanceReason ?? null,
      knowledgeSourceId: sourceId,
      modules: { create: named.map((m) => ({ moduleId: m.id })) },
    },
  });
}
