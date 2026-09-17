import type { PrismaClient } from "@prisma/client";
import { splitParagraphs } from "@/lib/knowledge/documents";
import { diffVersions, type DiffSegment } from "@/lib/knowledge/diff";
import { createReader, Blocked, CapReached, type FetchLogEntry } from "@/lib/portal/fetch";
import { portalEnabled } from "@/lib/portal/enabled";
import { hasProfile } from "@/lib/portal/session";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Watching a portal page. A watched page is a document that edits itself, so
// this mirrors documentPipeline.ts and reuses the same diff.
//
// Stages: fetch -> store -> compare -> published. No model call anywhere —
// re-checking a release-notes page that hasn't changed costs nothing at all,
// which is what makes it reasonable to check often.
// ---------------------------------------------------------------------------

export const PAGE_STAGES = ["fetch", "store", "compare", "published"] as const;

type Ctx = {
  prisma: PrismaClient;
  job: { id: string; sourceId: string; stage: string; kind?: string };
  workerId: string;
  // Injected so the whole pipeline is testable with a fake browser.
  openBrowser?: () => Promise<{
    ctx: any;
    signedOut(): Promise<boolean>;
    close(): Promise<void>;
  }>;
};

async function setStage(prisma: PrismaClient, jobId: string, stage: string) {
  await prisma.researchJob.update({ where: { id: jobId }, data: { stage } });
}

type Preview = {
  title: string;
  textSample: string;
  paragraphs: number;
  links: string[];
  // The repeating structure of a listing page, so a parser can be written
  // against the real markup instead of a guess.
  structure?: unknown;
};

async function finish(
  prisma: PrismaClient,
  jobId: string,
  state: "succeeded" | "failed" | "needs_input",
  log: FetchLogEntry[],
  error?: { code: string; message: string },
  preview?: Preview,
) {
  await prisma.researchJob.update({
    where: { id: jobId },
    data: {
      state,
      finishedAt: new Date(),
      // The audit trail: every URL touched, with its outcome — plus, for a
      // preview, what the page actually looked like once extracted.
      detail: log.length || preview ? JSON.stringify({ log, preview }) : null,
      errorCode: error?.code ?? null,
      errorMessage: error?.message?.slice(0, 300) ?? null,
    },
  });
}

export async function runPageJob(ctx: Ctx): Promise<void> {
  const { prisma, job } = ctx;
  const dryRun = job.kind === "page_dry";

  const source = await prisma.knowledgeSource.findUnique({
    where: { id: job.sourceId },
  });
  if (!source) {
    await finish(prisma, job.id, "failed", [], {
      code: "source_missing",
      message: "Source record is gone.",
    });
    return;
  }

  // The gate, before anything opens a browser.
  if (!(await portalEnabled())) {
    await finish(prisma, job.id, "needs_input", [], {
      code: "portal_disabled",
      message:
        "Portal access is switched off. Turn it on from the Knowledge page to confirm automated access is permitted.",
    });
    return;
  }

  if (!hasProfile()) {
    await finish(prisma, job.id, "needs_input", [], {
      code: "no_session",
      message: "No saved portal session. Run: npm run portal:login",
    });
    return;
  }

  await setStage(prisma, job.id, "fetch");

  let browser;
  try {
    browser = await (ctx.openBrowser
      ? ctx.openBrowser()
      : import("@/lib/portal/browser").then((m) => m.openBrowser()));
  } catch (err: any) {
    await finish(prisma, job.id, "needs_input", [], {
      code: "no_browser",
      message: String(err?.message ?? err),
    });
    return;
  }

  // A preview reads ONE page — the same single page view you would do by hand —
  // and stores nothing. Showing the extracted text is the entire point: on an
  // unfamiliar page it is the only way to know whether the extraction is any
  // good before committing to storing and diffing it.
  const reader = createReader(browser.ctx, { cap: dryRun ? 1 : undefined });

  try {
    const page = await reader.read(source.canonicalUrl);

    if (dryRun) {
      const paragraphs = page ? splitParagraphs(page.text) : [];
      await finish(
        prisma,
        job.id,
        "needs_input",
        reader.log,
        {
          code: "preview",
          message: page
            ? `Preview only — nothing was stored. Extracted ${paragraphs.length} paragraphs.`
            : "Preview: the page could not be read.",
        },
        page
          ? {
              title: page.title,
              textSample: paragraphs.slice(0, 40).join("\n\n").slice(0, 8000),
              paragraphs: paragraphs.length,
              links: page.links.slice(0, 40),
              structure: (browser.ctx as any).sample
                ? await (browser.ctx as any).sample().catch(() => null)
                : null,
            }
          : undefined,
      );
      return;
    }

    if (!page) {
      const why = reader.log[reader.log.length - 1];
      await finish(prisma, job.id, "needs_input", reader.log, {
        code: why?.outcome === "refused" ? "refused" : "fetch_failed",
        message: why?.note ?? "The page could not be read.",
      });
      return;
    }

    if (await browser.signedOut()) {
      await finish(prisma, job.id, "needs_input", reader.log, {
        code: "session_expired",
        message: "The portal session has expired. Run: npm run portal:login",
      });
      return;
    }

    // ---- store ------------------------------------------------------------
    await setStage(prisma, job.id, "store");
    const paragraphs = splitParagraphs(page.text);
    if (paragraphs.length === 0) {
      await finish(prisma, job.id, "needs_input", reader.log, {
        code: "no_text",
        message: "That page had no readable text.",
      });
      return;
    }

    const hash = createHash("sha256").update(paragraphs.join("\n")).digest("hex");
    const identical = await prisma.sourceVersion.findFirst({
      where: { sourceId: source.id, contentHash: hash },
    });

    if (identical) {
      // Unchanged: no new version, nothing stored, nothing spent. This is the
      // case most checks land in, and it is why checking often is affordable.
      await prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { currentVersionId: identical.id },
      });
      await setStage(prisma, job.id, "published");
      await finish(prisma, job.id, "succeeded", reader.log);
      return;
    }

    const previousId = source.currentVersionId;
    const count = await prisma.sourceVersion.count({ where: { sourceId: source.id } });
    const version = await prisma.sourceVersion.create({
      data: {
        sourceId: source.id,
        version: count + 1,
        transcriptMethod: "manual_import",
        coverageStatus: "complete",
        contentHash: hash,
        limitations: "Visible page text only; the citation is the URL.",
      },
    });

    await prisma.transcriptSegment.createMany({
      data: paragraphs.map((text, i) => ({
        sourceVersionId: version.id,
        ordinal: i,
        startMs: 0,
        endMs: 0,
        page: null,
        text,
      })),
    });

    await prisma.knowledgeSource.update({
      where: { id: source.id },
      data: { currentVersionId: version.id, title: page.title || source.title },
    });

    // ---- compare ----------------------------------------------------------
    await setStage(prisma, job.id, "compare");
    if (previousId) {
      const before = await prisma.transcriptSegment.findMany({
        where: { sourceVersionId: previousId },
        orderBy: { ordinal: "asc" },
        select: { ordinal: true, page: true, text: true },
      });
      const after: DiffSegment[] = paragraphs.map((text, i) => ({
        ordinal: i,
        page: null,
        text,
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
    await finish(prisma, job.id, "succeeded", reader.log);
  } catch (err: any) {
    // Being blocked or hitting the cap are deliberate stops, not crashes.
    const blocked = err instanceof Blocked;
    const capped = err instanceof CapReached;
    await finish(prisma, job.id, "needs_input", reader.log, {
      code: blocked ? "blocked" : capped ? "page_cap" : "error",
      message: String(err?.message ?? err),
    });
  } finally {
    await browser.close().catch(() => {});
  }
}
