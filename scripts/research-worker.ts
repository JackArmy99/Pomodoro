// Beacon research worker — owns long-running video jobs.
//
// Runs as its own process so a job survives the browser, a page navigation and
// a dev-server reload. Start it with:  npm run worker   (or npm run dev:all)
//
// Safety properties:
//  - a job is claimed atomically, so two workers can't both run the same one
//  - a lease + heartbeat lets a crashed job be reclaimed instead of sticking
//  - work resumes from the last completed stage rather than starting over
//  - no SQLite write transaction is held open across a network call
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { runVideoJob } from "@/lib/research/video/pipeline";

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const LEASE_MS = 2 * 60 * 1000;
const IDLE_POLL_MS = 3000;
const HEARTBEAT_MS = 20_000;

let shuttingDown = false;

// Take one job atomically: updateMany's count tells us whether we actually won
// it, so a second worker racing for the same row simply gets nothing.
async function claimJob() {
  const now = new Date();
  const candidate = await prisma.researchJob.findFirst({
    where: {
      OR: [
        { state: "queued" },
        // Reclaim work whose worker died mid-flight (lease expired).
        { state: "running", leaseExpiresAt: { lt: now } },
        { state: "retry_wait", leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;

  const { count } = await prisma.researchJob.updateMany({
    where: { id: candidate.id, state: candidate.state },
    data: {
      state: "running",
      leaseOwner: WORKER_ID,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      heartbeatAt: now,
      attempt: { increment: 1 },
    },
  });
  if (count !== 1) return null; // lost the race

  return prisma.researchJob.findUnique({
    where: { id: candidate.id },
    include: { source: true },
  });
}

function startHeartbeat(jobId: string) {
  return setInterval(async () => {
    try {
      await prisma.researchJob.updateMany({
        where: { id: jobId, leaseOwner: WORKER_ID },
        data: {
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        },
      });
    } catch {
      /* transient — the next beat retries */
    }
  }, HEARTBEAT_MS);
}

async function main() {
  console.log(`[worker ${WORKER_ID}] ready — polling for video jobs`);
  while (!shuttingDown) {
    let job: Awaited<ReturnType<typeof claimJob>> = null;
    try {
      job = await claimJob();
    } catch (err) {
      console.error("[worker] could not claim a job:", (err as Error)?.message);
    }

    if (!job) {
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
      continue;
    }

    console.log(`[worker] job ${job.id} — ${job.source.canonicalUrl}`);
    const beat = startHeartbeat(job.id);
    try {
      await runVideoJob({ prisma, job, workerId: WORKER_ID });
      const after = await prisma.researchJob.findUnique({
        where: { id: job.id },
        select: { state: true, errorCode: true },
      });
      console.log(`[worker] job ${job.id} → ${after?.state}${after?.errorCode ? ` (${after.errorCode})` : ""}`);
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 300);
      console.error(`[worker] job ${job.id} failed:`, message);
      await prisma.researchJob
        .update({
          where: { id: job.id },
          data: {
            state: "failed",
            errorCode: "worker_error",
            errorMessage: message,
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
    } finally {
      clearInterval(beat);
    }
  }
  await prisma.$disconnect();
  console.log("[worker] stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(0);
    shuttingDown = true;
    console.log("\n[worker] finishing the current job, then stopping…");
  });
}

main().catch(async (err) => {
  console.error("[worker] fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
