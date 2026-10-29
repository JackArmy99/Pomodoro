import { prisma } from "@/lib/db";
import { classification, defaultDocType } from "@/lib/knowledge/authority";
import {
  canonicaliseYouTubeUrl,
  type VideoIdentity,
} from "@/lib/research/video/youtube";

// Jobs the worker has abandoned (crash, machine sleep) are reclaimable.
export const LEASE_MS = 2 * 60 * 1000;
// If nothing has heartbeat within this, assume the worker isn't running.
export const WORKER_STALE_MS = 90 * 1000;

export type EnqueueResult =
  | { ok: true; sourceId: string; created: boolean }
  | { ok: false; error: string };

// Submit a video for research. Idempotent by video id: pasting the same link
// (in any URL form) returns the existing source and never starts a second job,
// so a double-click can't cost money twice.
export async function enqueueVideo(url: string): Promise<EnqueueResult> {
  const identity = canonicaliseYouTubeUrl(url);
  if (identity) return enqueueIdentity(identity);

  // Not YouTube — a Tagetik Community webinar? Same box, so Jack never has to
  // know which route a video takes.
  const webinar = await enqueuePortalVideo(url);
  if (webinar) return webinar;

  return {
    ok: false,
    error:
      "That doesn't look like a video Beacon can watch. Paste a YouTube link, or a Tagetik Community library page that has a Watch button.",
  };
}

// "Check for new webinars": queue one read of the Library, filtered to
// Webinars. The listing is a source of its own (kind "library") so its checks
// have a history like everything else; it is hidden from the Knowledge list.
export async function enqueueLibraryScan(): Promise<EnqueueResult> {
  const { WEBINARS_URL } = await import("@/lib/portal/library");
  const externalId = "community.tagetik.com/library?asset_type=webinars";
  const source =
    (await prisma.knowledgeSource.findUnique({
      where: { provider_externalId_ownerId: { provider: "portal", externalId, ownerId: "me" } },
    })) ??
    (await prisma.knowledgeSource.create({
      data: {
        provider: "portal",
        kind: "library",
        externalId,
        canonicalUrl: WEBINARS_URL,
        title: "Tagetik Library — Webinars",
      },
    }));

  const active = await prisma.researchJob.findFirst({
    where: { sourceId: source.id, state: { in: ["queued", "running", "retry_wait"] } },
  });
  if (!active) {
    await prisma.researchJob.create({
      data: { sourceId: source.id, kind: "library_scan", stage: "check" },
    });
  }
  return { ok: true, sourceId: source.id, created: !active };
}

// A Tagetik Community webinar: its library page, e.g.
// https://community.tagetik.com/library/wb-product-demo-…
// Returns null when the address isn't one, so the caller can say so.
export async function enqueuePortalVideo(rawUrl: string): Promise<EnqueueResult | null> {
  const { checkUrl } = await import("@/lib/portal/allowlist");
  const { libraryKey } = await import("@/lib/portal/library");
  const verdict = checkUrl(rawUrl.trim());
  if (!verdict.ok) return null;
  const u = verdict.url;
  // An item's own page, not the listing. The key is shared with the Library
  // shortlist, so an item is "already watched" however it arrived.
  const externalId = libraryKey(u.toString());
  if (!externalId) return null;

  u.hash = "";
  u.search = "";
  const canonicalUrl = u.toString();

  const existing = await prisma.knowledgeSource.findUnique({
    where: {
      provider_externalId_ownerId: { provider: "tagetik", externalId, ownerId: "me" },
    },
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (existing) {
    const last = existing.jobs[0];
    const active = last && ["queued", "running", "retry_wait"].includes(last.state);
    if (!active && (!last || ["failed", "cancelled", "needs_input"].includes(last.state))) {
      await prisma.researchJob.create({ data: { sourceId: existing.id, kind: "video" } });
    }
    return { ok: true, sourceId: existing.id, created: false };
  }

  const source = await prisma.knowledgeSource.create({
    data: {
      provider: "tagetik",
      kind: "portal_video",
      ...classification(defaultDocType("portal_video")),
      externalId,
      canonicalUrl,
      title: placeholderTitle(u),
      channel: "CCH Tagetik Community",
      jobs: { create: { kind: "video" } },
    },
  });
  return { ok: true, sourceId: source.id, created: true };
}

async function enqueueIdentity(identity: VideoIdentity): Promise<EnqueueResult> {
  const existing = await prisma.knowledgeSource.findUnique({
    where: {
      provider_externalId_ownerId: {
        provider: "youtube",
        externalId: identity.videoId,
        ownerId: "me",
      },
    },
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (existing) {
    const last = existing.jobs[0];
    const active =
      last && ["queued", "running", "retry_wait"].includes(last.state);
    // Only re-queue when the previous attempt actually finished unsuccessfully.
    if (!active && (!last || ["failed", "cancelled"].includes(last.state))) {
      await prisma.researchJob.create({ data: { sourceId: existing.id } });
    }
    return { ok: true, sourceId: existing.id, created: false };
  }

  const source = await prisma.knowledgeSource.create({
    data: {
      provider: "youtube",
      kind: "youtube",
      ...classification(defaultDocType("youtube")),
      externalId: identity.videoId,
      canonicalUrl: identity.canonicalUrl,
      jobs: { create: {} },
    },
  });
  return { ok: true, sourceId: source.id, created: true };
}

// Re-run a source that failed or needs input.
//
// The kind MUST be set explicitly. `ResearchJob.kind` defaults to "video", so
// omitting it turned every retry of a page or a document into a video job —
// which is how "Try again" on a Tagetik page ended up asking YouTube for
// captions and failing with a network error.
export async function requeueSource(sourceId: string): Promise<void> {
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
    select: { kind: true },
  });
  if (!source) return;

  const active = await prisma.researchJob.findFirst({
    where: { sourceId, state: { in: ["queued", "running", "retry_wait"] } },
  });
  if (active) return;

  const { retryKindFor } = await import("@/lib/knowledge/jobKinds");
  const kind = retryKindFor(source.kind);
  await prisma.researchJob.create({
    data: { sourceId, kind, stage: kind === "page" ? "fetch" : "validate" },
  });
}

export async function cancelJob(jobId: string): Promise<void> {
  await prisma.researchJob.updateMany({
    where: { id: jobId, state: { in: ["queued", "running", "retry_wait"] } },
    data: { cancelRequestedAt: new Date() },
  });
}

// Is a worker alive? Used to warn instead of leaving a job silently queued.
export async function workerLooksAlive(): Promise<boolean> {
  const cutoff = new Date(Date.now() - WORKER_STALE_MS);

  // Two signals: a job being actively worked on, or the idle poll. Without the
  // second, a worker that is running but has nothing to do reads as "not
  // running" — which is both wrong and the state it spends most time in.
  const [busy, idle] = await Promise.all([
    prisma.researchJob.findFirst({
      where: { heartbeatAt: { gt: cutoff } },
      select: { id: true },
    }),
    prisma.setting.findUnique({ where: { key: "worker_heartbeat" } }),
  ]);

  if (busy) return true;
  if (!idle?.value) return false;
  const beat = new Date(idle.value);
  return !Number.isNaN(beat.getTime()) && beat > cutoff;
}

// Re-analyse a video we already hold, without re-fetching captions. The job
// starts at the `summarise` stage, so the pipeline skips the whole acquisition
// half and works from the stored transcript.
export async function enqueueAnalysis(sourceId: string): Promise<void> {
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
    select: { currentVersionId: true },
  });
  if (!source?.currentVersionId) return; // nothing stored to summarise yet

  const active = await prisma.researchJob.findFirst({
    where: { sourceId, state: { in: ["queued", "running", "retry_wait"] } },
  });
  if (active) return;

  await prisma.researchJob.create({
    data: { sourceId, kind: "analyse", stage: "summarise" },
  });
}

// Save an uploaded document and queue it for import. The bytes go to disk and
// the worker does the parsing, so the browser never waits on a 300-page PDF.
export async function enqueueDocument(
  fileName: string,
  bytes: Buffer,
  opts: {
    docType?: string | null;
    release?: string | null;
    // An existing document this upload is a newer (or older) edition of —
    // manuals are usually renamed per release, so the file name alone can't
    // say that "Consolidation_2026.pdf" is a version of "…_2025.pdf".
    versionOf?: string | null;
  } = {},
): Promise<EnqueueResult> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { documentKey } = await import("@/lib/knowledge/documents");
  const { classification, normaliseRelease } = await import("@/lib/knowledge/authority");

  let key = documentKey(fileName);
  if (opts.versionOf) {
    const parent = await prisma.knowledgeSource.findUnique({
      where: { id: opts.versionOf },
      select: { kind: true, provider: true, externalId: true },
    });
    if (!parent || parent.kind !== "document" || parent.provider !== "upload") {
      return { ok: false, error: "The document to add a version to wasn't found." };
    }
    key = parent.externalId;
  }
  const release = normaliseRelease(opts.release);
  const cls = opts.docType ? classification(opts.docType) : null;
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  // Overridable only so the test gates never write into the real storage.
  const dir = process.env.BEACON_DOCUMENTS_DIR || join(root, "storage", "documents");
  await mkdir(dir, { recursive: true });

  // Named by document identity, not by upload: a revised manual with the same
  // name overwrites the file and becomes a new VERSION of the same source,
  // which is what makes change detection possible.
  const safeExt = (fileName.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? ".bin").toLowerCase();
  const path = join(dir, `${key}${safeExt}`);
  await writeFile(path, bytes);

  const existing = await prisma.knowledgeSource.findUnique({
    where: {
      provider_externalId_ownerId: {
        provider: "upload",
        externalId: key,
        ownerId: "me",
      },
    },
  });

  const source =
    existing ??
    (await prisma.knowledgeSource.create({
      data: {
        provider: "upload",
        kind: "document",
        externalId: key,
        canonicalUrl: `file:${path}`,
        title: fileName,
        ...(cls ?? classification(null)),
      },
    }));

  if (existing) {
    await prisma.knowledgeSource.update({
      where: { id: source.id },
      data: {
        canonicalUrl: `file:${path}`,
        // A renamed edition keeps the document's existing name.
        ...(opts.versionOf ? {} : { title: fileName }),
        ...(cls ?? {}),
      },
    });
  }

  const active = await prisma.researchJob.findFirst({
    where: { sourceId: source.id, state: { in: ["queued", "running", "retry_wait"] } },
  });
  if (!active) {
    await prisma.researchJob.create({
      data: {
        sourceId: source.id,
        kind: "document",
        stage: "read",
        detail: JSON.stringify({ release }),
      },
    });
  }

  return { ok: true, sourceId: source.id, created: !existing };
}

// Host + path, so a watched page is identifiable in the list before it has
// ever been fetched. Replaced by the page's real title on the first read.
function placeholderTitle(url: URL): string {
  const path = url.pathname.replace(/\/$/, "");
  return `${url.hostname}${path}`.slice(0, 200);
}

// Watch a portal page. The URL is checked against the allowlist here, so an
// off-limits address never even becomes a source.
export async function enqueuePage(
  rawUrl: string,
  { dryRun = true }: { dryRun?: boolean } = {},
): Promise<EnqueueResult> {
  const { checkUrl } = await import("@/lib/portal/allowlist");
  const verdict = checkUrl(rawUrl);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const url = verdict.url.toString();
  const externalId = url.replace(/^https:\/\//, "").slice(0, 200);

  const existing = await prisma.knowledgeSource.findUnique({
    where: {
      provider_externalId_ownerId: {
        provider: "portal",
        externalId,
        ownerId: "me",
      },
    },
  });

  const source =
    existing ??
    (await prisma.knowledgeSource.create({
      data: {
        provider: "portal",
        kind: "page",
        ...classification(defaultDocType("page")),
        externalId,
        canonicalUrl: url,
        // A placeholder until the first fetch reads the page's own <title>.
        // The path alone ("/library") says nothing about which site it is on.
        title: placeholderTitle(verdict.url),
      },
    }));

  const active = await prisma.researchJob.findFirst({
    where: { sourceId: source.id, state: { in: ["queued", "running", "retry_wait"] } },
  });
  if (!active) {
    await prisma.researchJob.create({
      data: {
        sourceId: source.id,
        kind: dryRun ? "page_dry" : "page",
        stage: "fetch",
      },
    });
  }

  return { ok: true, sourceId: source.id, created: !existing };
}

// Assess a stored page: one model call, one pending inbox item.
//
// Deliberately separate from re-checking the page. Fetching and diffing are
// free and can run as often as you like; this is the step that spends money, so
// it only ever happens because someone pressed the button.
export async function enqueuePageAssessment(
  sourceId: string,
): Promise<EnqueueResult> {
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
    select: { id: true, currentVersionId: true },
  });
  if (!source) return { ok: false, error: "That source no longer exists." };
  if (!source.currentVersionId) {
    return {
      ok: false,
      error:
        "Nothing is stored for this page yet — check it for changes first, then assess it.",
    };
  }

  const active = await prisma.researchJob.findFirst({
    where: { sourceId, state: { in: ["queued", "running", "retry_wait"] } },
  });
  if (!active) {
    await prisma.researchJob.create({
      data: { sourceId, kind: "page_assess", stage: "summarise" },
    });
  }

  return { ok: true, sourceId, created: !active };
}
