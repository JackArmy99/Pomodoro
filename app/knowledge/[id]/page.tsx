import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  retrySource,
  cancelSourceJob,
  summariseSource,
  recheckPage,
} from "@/app/actions/knowledge";
import SubmitButton from "@/components/SubmitButton";
import AutoRefresh from "@/components/AutoRefresh";
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

  const isDocument = source.kind === "document";
  const isPage = source.kind === "page";
  // The audit trail of every URL this run touched.
  let fetchLog: any[] = [];
  try {
    if (job?.detail) fetchLog = JSON.parse(job.detail);
  } catch {
    fetchLog = [];
  }

  // Documents record a diff against the previous version — computed locally, so
  // it exists whether or not anyone ever pays to have it explained.
  const diffRevision = version
    ? await prisma.analysisRevision.findFirst({
        where: { sourceVersionId: version.id, pipelineVersion: "diff" },
        orderBy: { createdAt: "desc" },
      })
    : null;
  let changes: any[] = [];
  let changeCoverage: any = null;
  try {
    if (diffRevision?.summaryJson) changes = JSON.parse(diffRevision.summaryJson).changes ?? [];
    if (diffRevision?.coverageJson) changeCoverage = JSON.parse(diffRevision.coverageJson);
  } catch {
    changes = [];
  }

  const finding = await prisma.finding.findUnique({
    where: { knowledgeSourceId: source.id },
    select: { id: true, status: true },
  });

  // One cumulative number can't be reasoned about — a re-run looks like an
  // expensive run. Break it down per run and per stage.
  const allJobs = await prisma.researchJob.findMany({
    where: { sourceId: source.id },
    orderBy: { createdAt: "asc" },
    include: { calls: { orderBy: { createdAt: "asc" } } },
  });
  const totalMicroUsd = allJobs.reduce((n, j) => n + j.spentMicroUsd, 0);
  const paidRuns = allJobs.filter((j) => j.spentMicroUsd > 0);

  const workerAlive = await workerLooksAlive();
  const pending = ["queued", "running", "retry_wait"].includes(job?.state ?? "");

  return (
    <div className="space-y-6">
      {/* While a job runs, the page updates itself. */}
      <AutoRefresh active={pending} />
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
          {isDocument && (
            <span className="chip border-slate-200 bg-slate-50 text-slate-600">
              Document{version ? ` · version ${version.version}` : ""}
            </span>
          )}
          {version && (
            <span className="chip border-slate-200 bg-slate-50 text-slate-600">
              {version.transcriptMethod === "captions"
                ? "From captions"
                : "Imported text"}
            </span>
          )}
          {/* Notes are always English; say so when the source isn't, so a
              translated summary is never mistaken for the speaker's words. */}
          {version?.language && !version.language.toLowerCase().startsWith("en") && (
            <span className="chip border-violet-200 bg-violet-50 text-violet-700">
              Spoken {version.language} · notes in English
            </span>
          )}
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          {source.title || source.canonicalUrl}
        </h1>
        {source.channel && (
          <p className="text-sm text-slate-500">{source.channel}</p>
        )}
        {isDocument ? (
          <p className="text-xs text-slate-400">
            Imported file · {source.externalId}
          </p>
        ) : (
          <a
            href={source.canonicalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            Watch on YouTube ↗
          </a>
        )}
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
            {job.attempt > 0 ? ` · attempt ${job.attempt + 1}` : ""}. This page
            updates itself.
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

      {/* What changed — for documents this is computed locally, so it is free
          and available on every re-import. */}
      {(isDocument || isPage) && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">
            What changed in this version
          </h2>
          {!diffRevision ? (
            <p className="card text-sm text-slate-500">
              This is the first version, so there is nothing to compare
              against. {isPage
                ? "Re-check the page later and the changes will appear here."
                : "Upload a newer file with the same name and the changes will appear here."}
            </p>
          ) : changes.length === 0 ? (
            <p className="card text-sm text-slate-500">
              Nothing changed from the previous version.
            </p>
          ) : (
            <div className="card space-y-3">
              <p className="text-xs text-slate-500">
                {changes.length} change{changes.length === 1 ? "" : "s"}
                {changeCoverage
                  ? ` · ${changeCoverage.unchanged} paragraphs unchanged`
                  : ""}
                . Worked out on this machine — no AI, no cost.
              </p>
              {changes.slice(0, 60).map((c: any, i: number) => (
                <div key={i} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {c.kind === "changed"
                      ? "Reworded"
                      : c.kind === "added"
                        ? "Added"
                        : "Removed"}
                    {c.page ? ` · page ${c.page}` : ""}
                  </p>
                  {c.kind === "changed" ? (
                    <>
                      <p className="text-sm text-rose-700 line-through decoration-rose-300">
                        {c.before}
                      </p>
                      <p className="text-sm text-emerald-800">{c.after}</p>
                    </>
                  ) : (
                    <p
                      className={`text-sm ${c.kind === "added" ? "text-emerald-800" : "text-rose-700 line-through decoration-rose-300"}`}
                    >
                      {c.text}
                    </p>
                  )}
                </div>
              ))}
              {changes.length > 60 && (
                <p className="text-xs text-slate-400">
                  Showing the first 60 of {changes.length} changes.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Summary — what the video actually says, most important first. Every
          point links to the second of the video it came from. */}
      {!isDocument && (
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

      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">
          {isDocument ? "Contents" : "Transcript"}{" "}
          {version && (
            <span className="font-normal text-slate-400">
              ({version._count.segments}{" "}
              {isDocument ? "paragraphs" : "segments"}, stored in full)
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
                  {isDocument ? (
                    <span className="shrink-0 font-mono text-xs text-slate-400">
                      {s.page ? `p${s.page}` : "—"}
                    </span>
                  ) : (
                    <a
                      href={timestampUrl(source.canonicalUrl, s.startMs)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 font-mono text-xs text-indigo-600 hover:underline"
                    >
                      {formatTimestamp(s.startMs)}
                    </a>
                  )}
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

      {isPage && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              Pages this run touched
            </h2>
            {!pending && (
              <form action={recheckPage}>
                <input type="hidden" name="sourceId" value={source.id} />
                <SubmitButton pendingLabel="Queueing…">
                  Check for changes
                </SubmitButton>
              </form>
            )}
          </div>
          {fetchLog.length === 0 ? (
            <p className="card text-sm text-slate-500">
              Nothing fetched yet.
            </p>
          ) : (
            <ul className="card space-y-1 text-xs">
              {fetchLog.map((entry: any, i: number) => (
                <li key={i} className="flex flex-wrap gap-2">
                  <span
                    className={
                      entry.outcome === "fetched"
                        ? "text-emerald-700"
                        : entry.outcome === "would-fetch"
                          ? "text-slate-500"
                          : "text-amber-700"
                    }
                  >
                    {entry.outcome}
                  </span>
                  <span className="text-slate-600">{entry.url}</span>
                  {entry.note && (
                    <span className="text-slate-400">— {entry.note}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Processing details</h2>
        <ul className="card space-y-1 text-xs text-slate-500">
          <li>Added: {formatDate(source.createdAt)}</li>
          <li>Video id: {source.externalId}</li>
          {version && <li>Transcript language: {version.language ?? "unknown"}</li>}
          {job && <li>Job state: {job.state} · stage {job.stage}</li>}
          {job?.finishedAt && <li>Finished: {formatDate(job.finishedAt)}</li>}
          <li>
            Model cost: <strong>{formatPence(totalMicroUsd)}</strong> in total
            across {paidRuns.length} run{paidRuns.length === 1 ? "" : "s"}{" "}
            (estimate). Each re-run is charged again — the total is for this
            video, not this run.
          </li>
          {paidRuns.map((j, i) => (
            <li key={j.id} className="pl-3 text-slate-400">
              Run {i + 1}: {formatPence(j.spentMicroUsd)}
              {j.calls.length > 0 && (
                <>
                  {" — "}
                  {j.calls
                    .map((c) => `${c.stage} ${formatPence(c.costMicroUsd)}`)
                    .join(" · ")}
                </>
              )}
            </li>
          ))}
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
