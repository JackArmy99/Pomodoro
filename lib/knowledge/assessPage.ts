import type { PrismaClient } from "@prisma/client";
import { recordStep, noteStep } from "@/lib/knowledge/runLog";
import { summariseItem } from "@/lib/anthropic";
import { microUsd } from "@/lib/research/cost";
import { upsertSourceFinding } from "@/lib/knowledge/finding";

// Turn a stored page into one pending inbox item.
//
// A watched page is free to fetch, store and diff — no model call is involved
// anywhere in that. This is the ONE step that costs money, which is why it is a
// button and never automatic: a page nobody needs assessed costs nothing to
// keep watching.
//
// It reads what is already stored. Nothing is fetched here, so assessing a
// webinar page again after editing the grounding costs one small call and no
// portal traffic at all.

export const ASSESS_STAGES = ["summarise", "finding", "published"] as const;

type Ctx = {
  prisma: PrismaClient;
  job: { id: string; sourceId: string; stage: string; kind?: string };
  workerId: string;
};

// Every step is recorded, not just the one in progress: after a run the
// question is always where it stopped and what it managed first.
async function setStage(prisma: PrismaClient, jobId: string, stage: string, note?: string) {
  await recordStep(prisma, jobId, stage, note);
}

async function finish(
  prisma: PrismaClient,
  jobId: string,
  state: "succeeded" | "failed" | "needs_input",
  error?: { code: string; message: string },
) {
  await prisma.researchJob.update({
    where: { id: jobId },
    data: {
      state,
      finishedAt: new Date(),
      errorCode: error?.code ?? null,
      errorMessage: error?.message?.slice(0, 300) ?? null,
    },
  });
}

// The site behind a URL, for the inbox's "issuing body" chip.
function bodyFor(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "community.tagetik.com" ? "CCH Tagetik Community" : host;
  } catch {
    return "portal";
  }
}

export async function runPageAssessJob(ctx: Ctx): Promise<void> {
  const { prisma, job } = ctx;

  // A step before the checks, for the same reason as the page pipeline: a run
  // that stops at "there is nothing stored yet" should say so on the timeline
  // rather than leaving it blank.
  await setStage(prisma, job.id, "check");

  const source = await prisma.knowledgeSource.findUnique({
    where: { id: job.sourceId },
  });
  if (!source) {
    await finish(prisma, job.id, "failed", {
      code: "source_missing",
      message: "Source record is gone.",
    });
    return;
  }

  if (!source.currentVersionId) {
    await finish(prisma, job.id, "needs_input", {
      code: "no_version",
      message:
        "Nothing is stored for this page yet. Check it for changes first, then assess it.",
    });
    return;
  }

  await setStage(prisma, job.id, "summarise");

  const segments = await prisma.transcriptSegment.findMany({
    where: { sourceVersionId: source.currentVersionId },
    orderBy: { ordinal: "asc" },
    select: { text: true },
  });
  const text = segments.map((s) => s.text).join("\n\n").trim();
  if (!text) {
    await finish(prisma, job.id, "needs_input", {
      code: "no_text",
      message: "The stored version has no text to assess.",
    });
    return;
  }

  const modules = await prisma.module.findMany({ select: { name: true } });

  const summary = await summariseItem({
    title: source.title,
    // The page text is untrusted third-party content; summariseItem says so in
    // its own prompt rather than trusting this caller to remember.
    content: text,
    moduleNames: modules.map((m) => m.name),
  });

  if (!summary) {
    await finish(prisma, job.id, "needs_input", {
      code: "no_api_key",
      message:
        "There's no ANTHROPIC_API_KEY set, so there was nothing to assess with. The page is stored in full — add the key and try again.",
    });
    return;
  }

  // Record what it cost, in micro-USD, like every other model call.
  if (summary.usage) {
    const cost = microUsd(
      summary.usage.model,
      summary.usage.inputTokens,
      summary.usage.outputTokens,
    );
    await prisma.modelCall.create({
      data: {
        jobId: job.id,
        stage: "summarise",
        model: summary.usage.model,
        inputTokens: summary.usage.inputTokens,
        outputTokens: summary.usage.outputTokens,
        costMicroUsd: cost,
      },
    });
    await prisma.researchJob.update({
      where: { id: job.id },
      data: { spentMicroUsd: { increment: cost } },
    });
  }

  await noteStep(
    prisma,
    job.id,
    `relevance ${summary.relevance}` +
      (summary.suggestedModules.length
        ? ` · ${summary.suggestedModules.join(", ")}`
        : " · no module matched"),
  );

  await setStage(prisma, job.id, "finding");
  await upsertSourceFinding(prisma, source.id, {
    title: source.title || source.canonicalUrl,
    summary: summary.summary,
    rawContent: text.slice(0, 4000),
    sourceUrl: source.canonicalUrl,
    sourceType: "portal",
    sourceBody: bodyFor(source.canonicalUrl),
    relevance: summary.relevance,
    relevanceReason: summary.relevanceReason,
    moduleNames: summary.suggestedModules,
  });

  await setStage(prisma, job.id, "published");
  await finish(prisma, job.id, "succeeded");
}
