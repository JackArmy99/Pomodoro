import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { acquireCaptions, fetchMetadata } from "@/lib/research/video/youtube";

// ---------------------------------------------------------------------------
// The video job pipeline. Stages run in order and each records itself on the
// job, so a worker restart resumes instead of repeating paid or slow work.
// Milestone 1 ends at `published`: the full timestamped transcript is stored.
// ---------------------------------------------------------------------------

export const STAGES = ["metadata", "captions", "store", "published"] as const;
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

    let versionId: string;
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
      await prisma.transcriptSegment.createMany({
        data: result.cues.map((c) => ({
          sourceVersionId: versionId,
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

    // 4. Published — Milestone 1 is complete once the evidence is durable.
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
