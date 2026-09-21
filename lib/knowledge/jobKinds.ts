// Which pipeline a job belongs to — decided once, and never by falling through.
//
// This exists because of a real failure. `ResearchJob.kind` defaults to
// "video", and `requeueSource()` created jobs without a kind, so pressing
// "Try again" on a watched portal page produced a *video* job. The worker's
// routing was a chain of `if` tests ending in an unguarded `else` → the video
// pipeline, which dutifully asked YouTube for captions for
// community.tagetik.com and failed with "network_error". The error was real,
// the pipeline was wrong, and nothing on screen said which had run.
//
// Two rules now:
//   1. the job's kind decides, when it names a pipeline;
//   2. otherwise the SOURCE's kind decides — a page is never handed to the
//      video pipeline just because a default said so.

export type Handler = "video" | "document" | "page" | "page_assess";

export type Routing = {
  handler: Handler;
  // Set when the job's kind and the source disagreed, so the run can say so
  // instead of silently doing something else.
  corrected?: string;
};

const BY_JOB_KIND: Record<string, Handler> = {
  video: "video",
  analyse: "video",
  document: "document",
  page: "page",
  page_dry: "page",
  page_assess: "page_assess",
};

const BY_SOURCE_KIND: Record<string, Handler> = {
  youtube: "video",
  document: "document",
  page: "page",
};

export function jobHandlerFor(jobKind: string, sourceKind: string): Routing {
  const fromSource = BY_SOURCE_KIND[sourceKind] ?? "video";
  const fromJob = BY_JOB_KIND[jobKind];

  // An unknown job kind is not a reason to guess: use the source.
  if (!fromJob) return { handler: fromSource };

  // A video job against something that is not a video is the bug above. The
  // source is the authority on what it is.
  if (fromJob === "video" && fromSource !== "video") {
    return {
      handler: fromSource,
      corrected: `job kind "${jobKind}" did not match a ${sourceKind} source — ran it as ${fromSource}`,
    };
  }

  return { handler: fromJob };
}

// The job kind to create when re-running a source from scratch.
export function retryKindFor(sourceKind: string): string {
  switch (sourceKind) {
    case "document":
      return "document";
    case "page":
      return "page";
    default:
      return "video";
  }
}
