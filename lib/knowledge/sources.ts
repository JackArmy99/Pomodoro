import { prisma } from "@/lib/db";
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
  if (!identity) {
    return {
      ok: false,
      error:
        "That doesn't look like a single public YouTube video. Paste a normal watch, youtu.be or Shorts link.",
    };
  }
  return enqueueIdentity(identity);
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
      externalId: identity.videoId,
      canonicalUrl: identity.canonicalUrl,
      jobs: { create: {} },
    },
  });
  return { ok: true, sourceId: source.id, created: true };
}

// Re-run a source that failed or needs input.
export async function requeueSource(sourceId: string): Promise<void> {
  const active = await prisma.researchJob.findFirst({
    where: { sourceId, state: { in: ["queued", "running", "retry_wait"] } },
  });
  if (active) return;
  await prisma.researchJob.create({ data: { sourceId } });
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
): Promise<EnqueueResult> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { documentKey } = await import("@/lib/knowledge/documents");

  const key = documentKey(fileName);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const dir = join(root, "storage", "documents");
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
      },
    }));

  if (existing) {
    await prisma.knowledgeSource.update({
      where: { id: source.id },
      data: { canonicalUrl: `file:${path}`, title: fileName },
    });
  }

  const active = await prisma.researchJob.findFirst({
    where: { sourceId: source.id, state: { in: ["queued", "running", "retry_wait"] } },
  });
  if (!active) {
    await prisma.researchJob.create({
      data: { sourceId: source.id, kind: "document", stage: "read" },
    });
  }

  return { ok: true, sourceId: source.id, created: !existing };
}
