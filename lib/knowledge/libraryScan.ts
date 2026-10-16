import type { PrismaClient } from "@prisma/client";
import { createReader, Blocked, CapReached } from "@/lib/portal/fetch";
import { portalEnabled } from "@/lib/portal/enabled";
import { hasProfile } from "@/lib/portal/session";
import { parseListing } from "@/lib/portal/library";
import { recordStep, noteStep, mergeDetail } from "@/lib/knowledge/runLog";

// "Check for new webinars": read ONE Library page — filtered by the Library's
// own Asset Type = Webinars, newest first — and list what's on it. Nothing is
// downloaded, transcribed or summarised here; that only happens for items Jack
// ticks. Same guardrails as every portal read: allowlist, cap, audit log,
// stop on 429/403, and "signed out" said plainly.
//
// The list lands on the job (`detail.items`). Which of those Beacon already
// holds, or Jack dismissed, is worked out when the page is shown — so the
// shortlist is always current against the record of what's been watched.

type Ctx = {
  prisma: PrismaClient;
  job: { id: string; sourceId: string; stage: string; kind?: string };
  workerId: string;
  openBrowser?: () => Promise<{ ctx: any; signedOut(): Promise<boolean>; close(): Promise<void> }>;
};

async function finish(
  prisma: PrismaClient,
  jobId: string,
  state: "succeeded" | "needs_input" | "failed",
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

export async function runLibraryScan(ctx: Ctx): Promise<void> {
  const { prisma, job } = ctx;
  await recordStep(prisma, job.id, "check");

  const source = await prisma.knowledgeSource.findUnique({ where: { id: job.sourceId } });
  if (!source) return finish(prisma, job.id, "failed", { code: "source_missing", message: "Source record is gone." });
  if (!(await portalEnabled())) {
    return finish(prisma, job.id, "needs_input", {
      code: "portal_disabled",
      message: "Portal access is switched off. Turn it on from the Knowledge page.",
    });
  }
  if (!hasProfile()) {
    return finish(prisma, job.id, "needs_input", {
      code: "no_session",
      message: "No saved portal session. Run: npm run portal:login",
    });
  }

  await recordStep(prisma, job.id, "fetch");
  let browser;
  try {
    browser = await (ctx.openBrowser
      ? ctx.openBrowser()
      : import("@/lib/portal/browser").then((m) => m.openBrowser()));
  } catch (err: any) {
    return finish(prisma, job.id, "needs_input", { code: "no_browser", message: String(err?.message ?? err) });
  }

  const reader = createReader(browser.ctx, { cap: 1 });
  try {
    const page = await reader.read(source.canonicalUrl);
    if (page && (await browser.signedOut())) {
      await mergeDetail(prisma, job.id, { log: reader.log });
      return finish(prisma, job.id, "needs_input", {
        code: "session_expired",
        message: "The portal sent us to its login page — your saved session has expired. Run: npm run portal:login",
      });
    }
    if (!page) {
      await mergeDetail(prisma, job.id, { log: reader.log });
      return finish(prisma, job.id, "needs_input", {
        code: "fetch_failed",
        message: reader.log[reader.log.length - 1]?.note ?? "The Library could not be read.",
      });
    }

    const raw = browser.ctx.listing ? await browser.ctx.listing() : [];
    const items = parseListing(raw);
    await mergeDetail(prisma, job.id, {
      log: reader.log,
      items,
      scannedAt: new Date().toISOString(),
    });
    if (items.length === 0) {
      // A page that read fine but listed nothing means the layout changed —
      // say so, rather than showing an empty list as if there were no webinars.
      return finish(prisma, job.id, "needs_input", {
        code: "no_items",
        message: "The Library page loaded but no items could be read from it. Its layout may have changed — tell Claude.",
      });
    }
    await noteStep(prisma, job.id, `${items.length} items listed`);
    await recordStep(prisma, job.id, "published");
    await finish(prisma, job.id, "succeeded");
  } catch (err: any) {
    await mergeDetail(prisma, job.id, { log: reader.log });
    const code = err instanceof Blocked ? "blocked" : err instanceof CapReached ? "page_cap" : "error";
    await finish(prisma, job.id, "needs_input", { code, message: String(err?.message ?? err) });
  } finally {
    await browser.close().catch(() => {});
  }
}
