import type { PrismaClient } from "@prisma/client";

// What the agent actually did, step by step.
//
// Every pipeline already tracked a single `stage` column — the step it was on
// right now — which is useless the moment a run ends: the one thing you want to
// know afterwards is where it stopped and what it had managed first. Worse, a
// mis-routed job (a page handed to the video pipeline) produced a YouTube error
// about a Tagetik URL and nothing on screen said which pipeline had run.
//
// So each step is appended to `ResearchJob.detail` with a timestamp and, where a
// number is the diagnosis, a note: "47 paragraphs", "2 pages fetched". No
// migration — `detail` is an existing nullable column and already holds JSON.

export type RunStep = {
  stage: string;
  at: string; // ISO
  state: "running" | "done" | "stopped";
  note?: string;
};

export type JobDetail = {
  steps?: RunStep[];
  log?: unknown[];
  preview?: unknown;
};

// Tolerant of every shape this column has ever held: the wrapper object, the
// bare fetch-log array written by earlier runs, and nothing at all.
export function parseDetail(detail: string | null | undefined): JobDetail {
  if (!detail) return {};
  try {
    const parsed = JSON.parse(detail);
    if (Array.isArray(parsed)) return { log: parsed };
    return parsed && typeof parsed === "object" ? (parsed as JobDetail) : {};
  } catch {
    return {};
  }
}

async function patch(
  prisma: PrismaClient,
  jobId: string,
  change: (detail: JobDetail) => JobDetail,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId },
    select: { detail: true },
  });
  if (!job) return;
  const next = change(parseDetail(job.detail));
  await prisma.researchJob.update({
    where: { id: jobId },
    data: { ...extra, detail: JSON.stringify(next) },
  });
}

// Start a step. Closes whatever was running before it, so the list reads as a
// sequence rather than a pile of half-finished work.
export async function recordStep(
  prisma: PrismaClient,
  jobId: string,
  stage: string,
  note?: string,
): Promise<void> {
  await patch(
    prisma,
    jobId,
    (detail) => {
      const steps = [...(detail.steps ?? [])];
      const last = steps[steps.length - 1];
      if (last?.state === "running") last.state = "done";
      steps.push({ stage, at: new Date().toISOString(), state: "running", note });
      return { ...detail, steps };
    },
    { stage },
  );
}

// Annotate the step in progress — the count that makes the step meaningful.
export async function noteStep(
  prisma: PrismaClient,
  jobId: string,
  note: string,
): Promise<void> {
  await patch(prisma, jobId, (detail) => {
    const steps = [...(detail.steps ?? [])];
    const last = steps[steps.length - 1];
    if (last) last.note = note;
    return { ...detail, steps };
  });
}

// Merge extra material into the detail without losing the steps. The page
// pipeline used to overwrite this column wholesale, which threw the step list
// away at exactly the moment it was worth reading — the end of a failed run.
export async function mergeDetail(
  prisma: PrismaClient,
  jobId: string,
  extra: Partial<JobDetail>,
): Promise<void> {
  await patch(prisma, jobId, (detail) => ({ ...detail, ...extra }));
}

// Close the run off against whatever state it actually reached. Called by the
// worker for every job, so it covers a clean finish, an early return and a
// crash alike. Idempotent: a step already closed is left alone.
export async function closeRun(prisma: PrismaClient, jobId: string): Promise<void> {
  const job = await prisma.researchJob.findUnique({
    where: { id: jobId },
    select: { detail: true, state: true, errorCode: true, errorMessage: true },
  });
  if (!job) return;

  const detail = parseDetail(job.detail);
  const steps = [...(detail.steps ?? [])];
  const last = steps[steps.length - 1];
  if (!last || last.state !== "running") return;

  const ended = ["succeeded", "published"].includes(job.state);
  last.state = ended ? "done" : "stopped";
  if (!ended) {
    last.note = job.errorMessage || job.errorCode || last.note;
  }

  await prisma.researchJob.update({
    where: { id: jobId },
    data: { detail: JSON.stringify({ ...detail, steps }) },
  });
}
