import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { recordStep, noteStep } from "@/lib/knowledge/runLog";
import {
  contentHash,
  extractPages,
  toSegments,
  type DocSegment,
} from "@/lib/knowledge/documents";
import { diffVersions, type DiffSegment } from "@/lib/knowledge/diff";

// ---------------------------------------------------------------------------
// Importing a document. Deliberately NO model call anywhere in here.
//
// Stages: read -> store -> compare -> published.
//
// A 300-page manual costs nothing to bring in and keep, however long it is.
// The model is only involved later, when a question is asked or when someone
// asks for the changes to be explained — which is what keeps a manual
// affordable to re-check on every release.
// ---------------------------------------------------------------------------

export const DOC_STAGES = ["read", "store", "compare", "published"] as const;
export type DocStage = (typeof DOC_STAGES)[number];

type Ctx = {
  prisma: PrismaClient;
  job: { id: string; sourceId: string; stage: string };
  workerId: string;
};

// Every step is recorded, not just the one in progress: after a run the
// question is always where it stopped and what it managed first.
async function setStage(prisma: PrismaClient, jobId: string, stage: DocStage, note?: string) {
  await recordStep(prisma, jobId, stage, note);
}

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

export async function runDocumentJob(ctx: Ctx): Promise<void> {
  const { prisma, job } = ctx;

  const source = await prisma.knowledgeSource.findUnique({
    where: { id: job.sourceId },
  });
  if (!source) {
    await fail(prisma, job.id, "failed", "source_missing", "Source record is gone.");
    return;
  }

  // 1. Read the file from disk. The upload wrote it there and returned
  //    immediately; the parsing is the worker's job.
  await setStage(prisma, job.id, "read");
  const path = source.canonicalUrl.startsWith("file:")
    ? source.canonicalUrl.slice("file:".length)
    : source.canonicalUrl;

  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch {
    await fail(
      prisma,
      job.id,
      "failed",
      "file_missing",
      "The uploaded file is no longer on disk. Upload it again.",
    );
    return;
  }

  const extracted = await extractPages(source.title || path, buffer);
  if (!extracted.ok) {
    await fail(prisma, job.id, "needs_input", extracted.code, extracted.message);
    return;
  }

  const segments = toSegments(extracted.pages);
  if (segments.length === 0) {
    await fail(
      prisma,
      job.id,
      "needs_input",
      "no_text",
      "No readable text was found in that file.",
    );
    return;
  }

  // 2. Store every paragraph, with the page it came from. Never truncated.
  await setStage(prisma, job.id, "store");
  const hash = contentHash(segments);

  const identical = await prisma.sourceVersion.findFirst({
    where: { sourceId: source.id, contentHash: hash },
  });
  if (identical) {
    // Re-uploading the same file is a no-op rather than a new version — so
    // re-importing by accident costs nothing and creates no false "changes".
    await prisma.knowledgeSource.update({
      where: { id: source.id },
      data: { currentVersionId: identical.id },
    });
    await setStage(prisma, job.id, "published");
    await prisma.researchJob.update({
      where: { id: job.id },
      data: { state: "succeeded", finishedAt: new Date(), errorCode: null },
    });
    return;
  }

  const previousId = source.currentVersionId;
  const previousCount = await prisma.sourceVersion.count({
    where: { sourceId: source.id },
  });

  const version = await prisma.sourceVersion.create({
    data: {
      sourceId: source.id,
      version: previousCount + 1,
      transcriptMethod: "manual_import",
      coverageStatus: "complete",
      contentHash: hash,
      limitations:
        extracted.unit === "section"
          ? "This format has no page numbers, so citations refer to sections."
          : null,
    },
  });

  await storeSegments(prisma, version.id, segments);

  await prisma.knowledgeSource.update({
    where: { id: source.id },
    data: {
      currentVersionId: version.id,
      durationMs: null,
      language: null,
    },
  });

  // 3. Compare with the previous version — locally, for free. Only the changed
  //    paragraphs would ever be sent to a model, and only on request.
  await setStage(prisma, job.id, "compare");
  if (previousId) {
    const before = await prisma.transcriptSegment.findMany({
      where: { sourceVersionId: previousId },
      orderBy: { ordinal: "asc" },
      select: { ordinal: true, page: true, text: true },
    });
    const after: DiffSegment[] = segments.map((s) => ({
      ordinal: s.ordinal,
      page: s.page,
      text: s.text,
    }));

    const result = diffVersions(before as DiffSegment[], after);
    await prisma.analysisRevision.create({
      data: {
        sourceVersionId: version.id,
        pipelineVersion: "diff",
        status: "published",
        summaryJson: JSON.stringify({
          previousVersionId: previousId,
          changes: result.changes,
        }),
        coverageJson: JSON.stringify({
          unchanged: result.unchanged,
          changed: result.changes.length,
          changedChars: result.changedChars,
        }),
      },
    });
  }

  await setStage(prisma, job.id, "published");
  await prisma.researchJob.update({
    where: { id: job.id },
    data: { state: "succeeded", finishedAt: new Date(), errorCode: null },
  });
}

// A long manual is tens of thousands of paragraphs; insert in batches so one
// oversized statement can't fail the whole import.
async function storeSegments(
  prisma: PrismaClient,
  sourceVersionId: string,
  segments: DocSegment[],
) {
  const BATCH = 2000;
  for (let i = 0; i < segments.length; i += BATCH) {
    await prisma.transcriptSegment.createMany({
      data: segments.slice(i, i + BATCH).map((s) => ({
        sourceVersionId,
        ordinal: s.ordinal,
        startMs: 0,
        endMs: 0,
        page: s.page,
        text: s.text,
      })),
    });
  }
}
