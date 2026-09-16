import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  retrySource,
  cancelSourceJob,
  summariseSource,
} from "@/app/actions/knowledge";
import SubmitButton from "@/components/SubmitButton";
import { workerLooksAlive } from "@/lib/knowledge/sources";
import {
  JOB_STATE_LABELS,
  JOB_STATE_STYLES,
  STAGE_LABELS,
  errorAdvice,
} from "@/lib/knowledge/format";
import type { VideoSummary, Coverage } from "@/lib/research/video/summarise";
import { formatPence } from "@/lib/research/cost";
import { RELEVANCE_STYLES, RELEVANCE_LABELS } from "@/lib/format";
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

  const analysis = version
    ? await prisma.analysisRevision.findFirst({
        where: { sourceVersionId: version.id, status: "published" },
        orderBy: { createdAt: "desc" },
      })
    : null;

  // Parsing is guarded: a malformed revision must not take the page down with
  // it — the transcript below is the thing that matters.
  let summary: VideoSummary | null = null;
  let coverage: Coverage | null = null;
  try {
    if (analysis?.summaryJson) summary = JSON.parse(analysis.summaryJson);
    if (analysis?.coverageJson) coverage = JSON.parse(analysis.coverageJson);
  } catch {
    summary = null;
  }
  if (summary && !Array.isArray(summary.points)) {
    summary = null; // malformed revision — show "not summarised yet"
  } else if (summary) {
    // Fields added after a revision was written must not blank the page.
    summary.takeaways ??= [];
    summary.steps ??= [];
    summary.limits ??= [];
    summary.modules ??= [];
  }

  // Citations can point anywhere in the video, not just the opening segments
  // shown below, so look up exactly the ones cited.
  const citedOrdinals = summary
    ? Array.from(
        new Set(
          [...summary.points, ...summary.steps].flatMap(
            (x) => x.segmentOrdinals ?? [],
          ),
        ),
      )
    : [];
  const citedSegments =
    version && citedOrdinals.length
      ? await prisma.transcriptSegment.findMany({
          where: { sourceVersionId: version.id, ordinal: { in: citedOrdinals } },
          select: { ordinal: true, startMs: true },
        })
      : [];
  const segmentStarts = new Map(citedSegments.map((s) => [s.ordinal, s.startMs]));

  const finding = await prisma.finding.findUnique({
    where: { knowledgeSourceId: source.id },
    select: { id: true, status: true },
  });

  const spent = await prisma.researchJob.aggregate({
    where: { sourceId: source.id },
    _sum: { spentMicroUsd: true },
  });

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
          Stop the app and run <code>npm run dev</code> — it starts both.
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
            {STAGE_LABELS[job.stage] ?? job.stage}
            {job.attempt > 0 ? ` · attempt ${job.attempt + 1}` : ""}. Refresh to
            see progress.
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

      {/* Summary — what the video actually says, most important first. Every
          point links to the second of the video it came from. */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Summary</h2>
          {version && !pending && (
            <form action={summariseSource}>
              <input type="hidden" name="sourceId" value={source.id} />
              <SubmitButton pendingLabel="Queueing…">
                {summary ? "Summarise again" : "Summarise"}
              </SubmitButton>
            </form>
          )}
        </div>

        {!summary ? (
          <p className="card text-sm text-slate-500">
            {version
              ? "Not summarised yet. The full transcript is stored — press Summarise to get the key points, each linked to the moment it came from."
              : "Nothing to summarise until the transcript is stored."}
          </p>
        ) : (
          <div className="card space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`chip ${RELEVANCE_STYLES[summary.relevance]}`}>
                {RELEVANCE_LABELS[summary.relevance]}
              </span>
              {summary.modules.map((m) => (
                <span
                  key={m}
                  className="chip border-indigo-100 bg-indigo-50 text-indigo-600"
                >
                  {m}
                </span>
              ))}
              {finding && (
                <Link
                  href={`/research/${finding.id}`}
                  className="ml-auto text-xs font-medium text-indigo-600 hover:underline"
                >
                  In the inbox ({finding.status}) →
                </Link>
              )}
            </div>

            {summary.overview && (
              <p className="text-sm text-slate-700">{summary.overview}</p>
            )}
            {summary.relevanceReason && (
              <p className="text-xs text-slate-500">{summary.relevanceReason}</p>
            )}

            {summary.takeaways.length > 0 && (
              <div className="space-y-1.5 rounded-lg bg-slate-50 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Takeaways
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">
                  {summary.takeaways.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary.points.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  What the video covers ({summary.points.length})
                </h3>
                {summary.points.map((p, i) => (
                  <div key={i} className="border-l-2 border-indigo-100 pl-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {p.heading}
                    </p>
                    {p.detail && (
                      <p className="mt-0.5 text-sm text-slate-700">{p.detail}</p>
                    )}
                    <Citations
                      ordinals={p.segmentOrdinals}
                      starts={segmentStarts}
                      url={source.canonicalUrl}
                    />
                  </div>
                ))}
              </div>
            )}

            {summary.steps.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Steps
                </h3>
                <ol className="list-decimal space-y-1.5 pl-5">
                  {summary.steps.map((st, i) => (
                    <li key={i} className="text-sm text-slate-800">
                      {st.text}
                      <Citations
                        ordinals={st.segmentOrdinals}
                        starts={segmentStarts}
                        url={source.canonicalUrl}
                      />
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {summary.limits.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  What this video doesn&apos;t establish
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {summary.limits.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            )}

            {coverage && coverage.droppedPoints.length > 0 && (
              <p className="text-xs text-amber-700">
                {coverage.droppedPoints.length} claim
                {coverage.droppedPoints.length === 1 ? " was" : "s were"} left
                out because they couldn&apos;t be traced to the transcript.
              </p>
            )}
          </div>
        )}
      </section>

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
          <li>
            Model cost so far: {formatPence(spent._sum.spentMicroUsd ?? 0)}{" "}
            (estimate)
          </li>
          <li className="pt-1 text-slate-400">
            Speech evidence only — this version does not inspect the video
            picture, so on-screen-only detail is not captured.
          </li>
        </ul>
      </section>
    </div>
  );
}

// The timestamps under a claim: each links straight to that second of the video,
// so any point can be checked in one click rather than taken on trust.
function Citations({
  ordinals,
  starts,
  url,
}: {
  ordinals: number[];
  starts: Map<number, number>;
  url: string;
}) {
  const known = (ordinals ?? []).filter((o) => starts.has(o));
  if (known.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-2">
      {known.map((o) => (
        <a
          key={o}
          href={timestampUrl(url, starts.get(o)!)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-indigo-600 hover:underline"
        >
          {formatTimestamp(starts.get(o)!)}
        </a>
      ))}
    </span>
  );
}
