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
  const recent = await prisma.researchJob.findFirst({
    where: { heartbeatAt: { gt: new Date(Date.now() - WORKER_STALE_MS) } },
    select: { id: true },
  });
  return Boolean(recent);
}
