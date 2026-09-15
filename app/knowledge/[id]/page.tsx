import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { retrySource, cancelSourceJob } from "@/app/actions/knowledge";
import { workerLooksAlive } from "@/lib/knowledge/sources";
import {
  JOB_STATE_LABELS,
  JOB_STATE_STYLES,
  errorAdvice,
} from "@/lib/knowledge/format";
import { formatTimestamp, timestampUrl } from "@/lib/research/video/youtube";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function KnowledgeSourcePage({
  params,
}: {
  params: { id: string };
}) {
  const source = await prisma.knowledgeSource.findUnique({
    where: { id: params.id },
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!source) notFound();

  const job = source.jobs[0];
  const version = source.currentVersionId
    ? await prisma.sourceVersion.findUnique({
        where: { id: source.currentVersionId },
        include: { _count: { select: { segments: true } } },
      })
    : null;

  // Show the opening of the transcript as proof the evidence is really stored.
  const segments = version
    ? await prisma.transcriptSegment.findMany({
        where: { sourceVersionId: version.id },
        orderBy: { ordinal: "asc" },
        take: 40,
      })
    : [];

  const workerAlive = await workerLooksAlive();
  const pending = ["queued", "running", "retry_wait"].includes(job?.state ?? "");

  return (
    <div className="space-y-6">
      <Link href="/knowledge" className="text-xs text-indigo-600 hover:underline">
        ← Knowledge
      </Link>

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip ${JOB_STATE_STYLES[job?.state ?? "queued"]}`}>
            {JOB_STATE_LABELS[job?.state ?? "queued"]}
          </span>
          {source.durationMs ? (
            <span className="chip border-slate-200 bg-slate-50 text-slate-600">
              {formatTimestamp(source.durationMs)}
            </span>
          ) : null}
          {version && (
            <span className="chip border-slate-200 bg-slate-50 text-slate-600">
              {version.transcriptMethod === "captions"
                ? "From captions"
                : "Imported text"}
            </span>
          )}
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          {source.title || source.canonicalUrl}
        </h1>
        {source.channel && (
          <p className="text-sm text-slate-500">{source.channel}</p>
        )}
        <a
          href={source.canonicalUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-indigo-600 hover:underline"
        >
          Watch on YouTube ↗
        </a>
      </header>

      {pending && !workerAlive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>Waiting on the research worker, which isn&apos;t running.</strong>{" "}
          Start it in a second terminal with <code>npm run worker</code>.
        </div>
      )}

      {job && ["failed", "needs_input", "cancelled"].includes(job.state) && (
        <div className="card space-y-2 border-amber-200 bg-amber-50/60">
          <h2 className="text-sm font-semibold text-amber-900">
            {job.state === "cancelled" ? "Cancelled" : "Couldn't finish"}
          </h2>
          <p className="text-sm text-amber-900">
            {job.state === "cancelled"
              ? "You stopped this job. Nothing was analysed."
              : errorAdvice(job.errorCode, job.errorMessage)}
          </p>
          <form action={retrySource}>
            <input type="hidden" name="sourceId" value={source.id} />
            <button type="submit" className="btn-ghost">
              Try again
            </button>
          </form>
        </div>
      )}

      {pending && job && (
        <div className="card flex items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            Stage: <strong>{job.stage}</strong> · attempt {job.attempt}. Refresh
            to see progress.
          </p>
          <form action={cancelSourceJob}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="sourceId" value={source.id} />
            <button type="submit" className="btn-ghost">
              Cancel
            </button>
          </form>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Transcript{" "}
          {version && (
            <span className="font-normal text-slate-400">
              ({version._count.segments} segments, stored in full)
            </span>
          )}
        </h2>
        {!version ? (
          <p className="card text-sm text-slate-500">
            Nothing stored yet — the transcript appears here once the job runs.
          </p>
        ) : (
          <>
            <div className="card divide-y divide-slate-100">
              {segments.map((s) => (
                <p key={s.id} className="flex gap-3 py-1.5 text-sm">
                  <a
                    href={timestampUrl(source.canonicalUrl, s.startMs)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-mono text-xs text-indigo-600 hover:underline"
                  >
                    {formatTimestamp(s.startMs)}
                  </a>
                  <span className="text-slate-700">{s.text}</span>
                </p>
              ))}
            </div>
            {version._count.segments > segments.length && (
              <p className="text-xs text-slate-400">
                Showing the first {segments.length} of{" "}
                {version._count.segments} segments. All of them are stored and
                will be searchable.
              </p>
            )}
          </>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Processing details</h2>
        <ul className="card space-y-1 text-xs text-slate-500">
          <li>Added: {formatDate(source.createdAt)}</li>
          <li>Video id: {source.externalId}</li>
          {version && <li>Transcript language: {version.language ?? "unknown"}</li>}
          {job && <li>Job state: {job.state} · stage {job.stage}</li>}
          {job?.finishedAt && <li>Finished: {formatDate(job.finishedAt)}</li>}
          <li className="pt-1 text-slate-400">
            Speech evidence only — this version does not inspect the video
            picture, so on-screen-only detail is not captured.
          </li>
        </ul>
      </section>
    </div>
  );
}
