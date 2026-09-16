import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { acquireCaptions, fetchMetadata } from "@/lib/research/video/youtube";
import { CLEARS_VERIFICATION } from "@/lib/research/revision";
import {
  summariseTranscript,
  summaryToText,
  type ModelUsage,
  type VideoSummary,
} from "@/lib/research/video/summarise";

// ---------------------------------------------------------------------------
// The video job pipeline. Stages run in order and each records itself on the
// job, so a worker restart resumes instead of repeating paid or slow work.
// A job can start part-way: enqueuing at `summarise` re-analyses a video whose
// transcript is already stored, without paying to fetch it again.
// ---------------------------------------------------------------------------

export const STAGES = [
  "metadata",
  "captions",
  "store",
  "summarise",
  "finding",
  "published",
] as const;
export type Stage = (typeof STAGES)[number];

type Ctx = {
  prisma: PrismaClient;
  job: { id: string; sourceId: string; stage: string };
  workerId: string;
};

class Cancelled extends Error {}

async function assertNotCancelled(prisma: PrismaClient, jobId: string) {
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId },
    select: { cancelRequestedAt: true },
  });
  if (job?.cancelRequestedAt) throw new Cancelled();
}

async function setStage(prisma: PrismaClient, jobId: string, stage: Stage) {
  await prisma.researchJob.update({ where: { id: jobId }, data: { stage } });
}

// Terminal failure with a reason the UI can explain in plain English.
async function fail(
  prisma: PrismaClient,
  jobId: string,
  state: "failed" | "needs_input",
  code: string,
  message: string,
) {
  await prisma.researchJob.update({
    where: { id: jobId },
    data: {
      state,
      errorCode: code,
      errorMessage: message.slice(0, 300),
      finishedAt: new Date(),
    },
  });
}

export async function runVideoJob(ctx: Ctx): Promise<void> {
  const { prisma, job } = ctx;
  const done = (s: Stage) => STAGES.indexOf(s) < STAGES.indexOf(job.stage as Stage);

  try {
    const source = await prisma.knowledgeSource.findUnique({
      where: { id: job.sourceId },
    });
    if (!source) {
      await fail(prisma, job.id, "failed", "source_missing", "Source record is gone.");
      return;
    }

    // ---- Acquisition (skipped entirely when resuming at `summarise`) -------
    // A re-analysis job starts at `summarise`, so the whole fetch half is
    // guarded: re-reading captions we already hold would be slow, rate-limited
    // and pointless.
    let versionId = source.currentVersionId;

    if (!done("store")) {
    // 1. Metadata — title/channel for the UI. Non-fatal if it fails, but we
    //    remember whether YouTube answered: that's how we avoid telling the user
    //    their video is "private" when the real problem is no connection.
    let confirmedReachable = true;
    if (!done("captions")) {
      await setStage(prisma, job.id, "metadata");
      const meta = await fetchMetadata(source.canonicalUrl);
      // Only a 200 proves we reached YouTube itself.
      confirmedReachable = meta.status === 200;
      await prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { title: meta.title, channel: meta.channel },
      });
    }

    await assertNotCancelled(prisma, job.id);

    // 2. Captions — the evidence. A failure here is classified, never guessed.
    await setStage(prisma, job.id, "captions");
    const result = await acquireCaptions(source.externalId);
    if (!result.ok) {
      // If YouTube never answered the metadata call either, the library's
      // "video unavailable" is really a connectivity failure — report that
      // instead, so the user isn't sent hunting for a permissions problem.
      // The transcript library reports "video unavailable" both for a genuinely
      // private/deleted video AND when it simply couldn't load the page. If we
      // never got a clean 200 from YouTube either, we don't actually know which
      // it was — so say so rather than accusing the user's video.
      const ambiguous =
        !confirmedReachable && result.code === "video_unavailable";
      const code = ambiguous ? "video_or_network" : result.code;
      const message = ambiguous
        ? "Couldn't load this video. It may be private or deleted — or this machine couldn't reach YouTube (a proxy, VPN or offline connection). Check the link opens in your browser, then retry."
        : result.message;

      // "No captions" / rate limits are recoverable by the user; a genuinely
      // unavailable video is not.
      const needsUser =
        code === "captions_disabled" ||
        code === "captions_not_available" ||
        code === "rate_limited" ||
        code === "network_error" ||
        code === "video_or_network";
      await fail(prisma, job.id, needsUser ? "needs_input" : "failed", code, message);
      return;
    }

    await assertNotCancelled(prisma, job.id);

    // 3. Store — every cue, with its timing. Deliberately no truncation.
    await setStage(prisma, job.id, "store");
    const contentHash = createHash("sha256")
      .update(result.cues.map((c) => `${c.startMs}:${c.text}`).join("\n"))
      .digest("hex");

    const existing = await prisma.sourceVersion.findFirst({
      where: { sourceId: source.id, contentHash },
    });

    if (existing) {
      versionId = existing.id; // identical re-acquisition — reuse it
    } else {
      const previous = await prisma.sourceVersion.count({
        where: { sourceId: source.id },
      });
      const version = await prisma.sourceVersion.create({
        data: {
          sourceId: source.id,
          version: previous + 1,
          transcriptMethod: "captions",
          language: result.language,
          coverageStatus: "complete",
          contentHash,
        },
      });
      versionId = version.id;

      // createMany keeps this to one statement rather than thousands.
      // (A local const, not `versionId` — the closure below loses the narrowing.)
      const newVersionId = version.id;
      await prisma.transcriptSegment.createMany({
        data: result.cues.map((c) => ({
          sourceVersionId: newVersionId,
          ordinal: c.ordinal,
          startMs: c.startMs,
          endMs: c.endMs,
          text: c.text,
        })),
      });
    }

    const lastCue = result.cues[result.cues.length - 1];
    await prisma.knowledgeSource.update({
      where: { id: source.id },
      data: {
        currentVersionId: versionId,
        durationMs: lastCue ? lastCue.endMs : null,
        language: result.language,
      },
    });
    } // ---- end acquisition --------------------------------------------------

    if (!versionId) {
      await fail(
        prisma,
        job.id,
        "failed",
        "no_version",
        "No stored transcript to work from.",
      );
      return;
    }

    await assertNotCancelled(prisma, job.id);

    // 4. Summarise — the transcript becomes something worth reading instead of
    //    the transcript. Failures here are NOT fatal to the evidence: the
    //    segments stay stored and the job can be re-run.
    let summary: VideoSummary | null = null;
    if (done("summarise")) {
      // Crashed between summarise and finding: the analysis is already paid
      // for and stored, so reuse it rather than calling the model again.
      const existing = await prisma.analysisRevision.findFirst({
        where: { sourceVersionId: versionId, status: "published" },
        orderBy: { createdAt: "desc" },
      });
      if (existing?.summaryJson) {
        try {
          summary = JSON.parse(existing.summaryJson) as VideoSummary;
        } catch {
          summary = null;
        }
      }
    }
    if (!summary) {
      await setStage(prisma, job.id, "summarise");
      summary = await summariseVersion(ctx, versionId);
    }
    if (!summary) return;

    await assertNotCancelled(prisma, job.id);

    // 5. Finding — one inbox item per source, unverified like any other.
    await setStage(prisma, job.id, "finding");
    await upsertFinding(ctx, source, summary);

    // 6. Published.
    await setStage(prisma, job.id, "published");
    await prisma.researchJob.update({
      where: { id: job.id },
      data: { state: "succeeded", finishedAt: new Date(), errorCode: null, errorMessage: null },
    });
  } catch (err) {
    if (err instanceof Cancelled) {
      await prisma.researchJob.update({
        where: { id: job.id },
        data: { state: "cancelled", finishedAt: new Date() },
      });
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

// Record what each model call cost, in micro-USD, against the job. Cents would
// round a summarise call to zero and make the running total meaningless.
async function recordUsage(
  prisma: PrismaClient,
  jobId: string,
  usage: ModelUsage[],
) {
  if (usage.length === 0) return;
  await prisma.modelCall.createMany({
    data: usage.map((u) => ({ ...u, jobId })),
  });
  const spent = usage.reduce((n, u) => n + u.costMicroUsd, 0);
  await prisma.researchJob.update({
    where: { id: jobId },
    data: { spentMicroUsd: { increment: spent } },
  });
}

// Summarise a stored version. Returns null when the job has been failed — the
// transcript is untouched either way, so a retry costs only the model call.
async function summariseVersion(
  ctx: Ctx,
  versionId: string,
): Promise<VideoSummary | null> {
  const { prisma, job } = ctx;

  const [segments, source, modules] = await Promise.all([
    prisma.transcriptSegment.findMany({
      where: { sourceVersionId: versionId },
      orderBy: { ordinal: "asc" },
      select: { ordinal: true, startMs: true, text: true },
    }),
    prisma.knowledgeSource.findUnique({ where: { id: job.sourceId } }),
    prisma.module.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
  ]);

  const result = await summariseTranscript({
    title: source?.title ?? "",
    channel: source?.channel ?? null,
    segments,
    moduleNames: modules.map((m) => m.name),
  });

  await recordUsage(prisma, job.id, result.usage);

  if (!result.ok) {
    // A missing key or a rate limit is the user's to resolve; the evidence is
    // already safe, so this is "needs input", not a dead end.
    const recoverable = ["no_api_key", "rate_limited", "bad_json", "no_valid_points"];
    await prisma.analysisRevision.create({
      data: {
        sourceVersionId: versionId,
        status: "failed",
        coverageJson: JSON.stringify({ error: result.code, message: result.message }),
      },
    });
    await fail(
      prisma,
      job.id,
      recoverable.includes(result.code) ? "needs_input" : "failed",
      result.code,
      result.message,
    );
    return null;
  }

  await prisma.analysisRevision.create({
    data: {
      sourceVersionId: versionId,
      status: "published",
      summaryJson: JSON.stringify(result.summary),
      coverageJson: JSON.stringify(result.coverage),
    },
  });

  return result.summary;
}

// One pending Finding per source. The unique knowledgeSourceId makes a second
// run update the existing item instead of filling the inbox with duplicates.
async function upsertFinding(
  ctx: Ctx,
  source: { id: string; title: string; canonicalUrl: string },
  summary: VideoSummary,
) {
  const { prisma } = ctx;

  const named = summary.modules.length
    ? await prisma.module.findMany({
        where: { name: { in: summary.modules } },
        select: { id: true },
      })
    : [];

  const text = summaryToText(summary);
  const existing = await prisma.finding.findUnique({
    where: { knowledgeSourceId: source.id },
    select: { id: true, status: true },
  });

  if (existing) {
    // Re-summarising changes the content, so any previous verification tick no
    // longer applies to what's on screen — the same rule the inbox editor uses.
    await prisma.$transaction([
      prisma.finding.update({
        where: { id: existing.id },
        data: {
          title: source.title || "(untitled video)",
          summary: text,
          relevance: summary.relevance,
          relevanceReason: summary.relevanceReason,
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
      title: source.title || "(untitled video)",
      summary: text,
      rawContent: summary.overview,
      sourceUrl: source.canonicalUrl,
      sourceType: "video",
      status: "pending",
      aiProcessed: true,
      relevance: summary.relevance,
      relevanceReason: summary.relevanceReason,
      knowledgeSourceId: source.id,
      modules: { create: named.map((m) => ({ moduleId: m.id })) },
    },
  });
}
