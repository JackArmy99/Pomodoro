import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  retrySource,
  cancelSourceJob,
  summariseSource,
  recheckPage,
  assessPage,
  setSourceClassification,
} from "@/app/actions/knowledge";
import { DOC_TYPES, RELEASE_SUGGESTIONS, docTypeLabel } from "@/lib/knowledge/authority";
import { proposeTreeFromSource } from "@/app/actions/kb";
import SubmitButton from "@/components/SubmitButton";
import AutoRefresh from "@/components/AutoRefresh";
import { workerLooksAlive } from "@/lib/knowledge/sources";
import { parseDetail } from "@/lib/knowledge/runLog";
import {
  JOB_STATE_LABELS,
  JOB_STATE_STYLES,
  STAGE_LABELS,
  jobKindLabel,
  errorAdvice,
  sourceView,
  libraryStatus,
} from "@/lib/knowledge/format";
import type { VideoSummary, Coverage } from "@/lib/research/video/summarise";
import { formatPence } from "@/lib/research/cost";
import { RELEVANCE_STYLES, RELEVANCE_LABELS } from "@/lib/format";
import { formatTimestamp, timestampUrl } from "@/lib/research/video/youtube";
import { formatDate } from "@/lib/format";
import { PageHeader, StatusChip, EmptyState, SidePanel, PanelBox, Advanced, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function KnowledgeSourcePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
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

  // The knowledge base: which module this covers, the edition's table of
  // contents, and whether that module already has a topic tree.
  const [modules, sections, moduleTopics] = await Promise.all([
    prisma.module.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    version
      ? prisma.docSection.findMany({
          where: { sourceVersionId: version.id },
          orderBy: { ordinal: "asc" },
          select: { id: true, path: true, title: true, level: true, page: true, method: true, topic: { select: { title: true } } },
        })
      : Promise.resolve([]),
    source.moduleId ? prisma.kbTopic.count({ where: { moduleId: source.moduleId } }) : Promise.resolve(0),
  ]);
  const moduleName = modules.find((m) => m.id === source.moduleId)?.name ?? null;

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

  // One decision per kind, in one place — see sourceView() for why.
  const view = sourceView(source.kind);
  const { isDocument, isPage } = view;
  // What the run did, and the audit trail of every URL it touched.
  // parseDetail copes with all three shapes this column has held: the wrapper
  // object, the bare fetch-log array older runs wrote, and nothing.
  const detail = parseDetail(job?.detail);
  const fetchLog: any[] = (detail.log as any[]) ?? [];
  const preview: any = detail.preview ?? null;
  const steps = detail.steps ?? [];

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
    select: { id: true, status: true, summary: true, relevance: true },
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
  const stopped = !!job && ["failed", "needs_input", "cancelled"].includes(job.state);

  // ---- Side panel: where this went and who it touches ----------------------
  const [versions, filedTopics] = await Promise.all([
    prisma.sourceVersion.findMany({
      where: { sourceId: source.id },
      orderBy: { version: "desc" },
      select: { id: true, version: true, release: true, acquiredAt: true },
    }),
    version
      ? prisma.kbTopic.findMany({
          where: { sections: { some: { sourceVersionId: version.id } } },
          select: { id: true, title: true, moduleId: true },
          orderBy: { order: "asc" },
          take: 12,
        })
      : Promise.resolve([]),
  ]);
  const affectModuleNames = new Set<string>([...(summary?.modules ?? []), ...(moduleName ? [moduleName] : [])]);
  const affected = affectModuleNames.size
    ? await prisma.client.findMany({
        where: { modules: { some: { module: { name: { in: [...affectModuleNames] } } } } },
        select: { id: true, name: true, color: true },
        orderBy: { name: "asc" },
      })
    : [];

  const status = libraryStatus(job?.state, source.kind);
  const kindLabel =
    source.kind === "portal_video" ? "Webinar" : source.kind === "youtube" ? "YouTube" : isPage ? "Page" : docTypeLabel(source.docType);

  return (
    <div className="space-y-5">
      <AutoRefresh active={pending} />
      <PageHeader
        back={{ href: "/library", label: "Library" }}
        title={source.title || source.canonicalUrl}
        chips={
          <>
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            <StatusChip>{kindLabel}</StatusChip>
            {source.durationMs ? <StatusChip>{formatTimestamp(source.durationMs)}</StatusChip> : null}
            {/* Notes are always English; say so when the source isn't. */}
            {version?.language && !version.language.toLowerCase().startsWith("en") && (
              <StatusChip tone="blue">Spoken {version.language} · notes in English</StatusChip>
            )}
          </>
        }
        action={
          <>
            {view.showVideoLink ? (
              <a href={source.canonicalUrl} target="_blank" rel="noreferrer" className="btn-ghost">
                Watch on YouTube ↗
              </a>
            ) : view.showPageLink ? (
              <a href={source.canonicalUrl} target="_blank" rel="noreferrer" className="btn-ghost">
                {view.isVideo ? "Watch on the Community ↗" : "Open the page ↗"}
              </a>
            ) : null}
            {isPage && !pending && (
              <form action={recheckPage}>
                <input type="hidden" name="sourceId" value={source.id} />
                <SubmitButton className="btn-ghost" pendingLabel="Queueing…">
                  Check for changes
                </SubmitButton>
              </form>
            )}
            {isPage && !pending && source.currentVersionId && (
              <form action={assessPage}>
                <input type="hidden" name="sourceId" value={source.id} />
                <SubmitButton pendingLabel="Queueing…">{finding ? "Re-assess" : "Add to the inbox"}</SubmitButton>
              </form>
            )}
          </>
        }
      />

      {searchParams.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{searchParams.error}</p>
      )}
      {pending && !workerAlive && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          The worker isn&apos;t running, so this will wait. Restart Beacon with <code>npm run dev</code>.
        </p>
      )}
      {stopped && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/60">
          <p className="text-sm text-amber-900">
            {job!.state === "cancelled"
              ? "Cancelled."
              : errorAdvice(job!.errorCode, job!.errorMessage, job!.kind)}
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
        <div className="card flex items-center justify-between gap-2 text-sm text-slate-600">
          <span>
            {STAGE_LABELS[job.stage] ?? job.stage}
            {job.attempt > 0 ? ` · attempt ${job.attempt + 1}` : ""}…
          </span>
          <form action={cancelSourceJob}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="sourceId" value={source.id} />
            <button type="submit" className="btn-ghost">
              Cancel
            </button>
          </form>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ---- The content ------------------------------------------------ */}
        <div className="min-w-0 space-y-5">
          {view.showSummary && (
            <Section
              title="Summary"
              action={
                version && !pending ? (
                  <form action={summariseSource}>
                    <input type="hidden" name="sourceId" value={source.id} />
                    <SubmitButton className="btn-ghost py-1.5" pendingLabel="Queueing…">
                      {summary ? "Summarise again" : "Summarise"}
                    </SubmitButton>
                  </form>
                ) : null
              }
            >
              {!summary ? (
                <EmptyState>{version ? "Not summarised yet." : "Waiting for the transcript."}</EmptyState>
              ) : (
                <div className="card space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`chip ${RELEVANCE_STYLES[summary.relevance]}`}>
                      {RELEVANCE_LABELS[summary.relevance]}
                    </span>
                    {summary.modules.map((m) => (
                      <StatusChip key={m} tone="blue">
                        {m}
                      </StatusChip>
                    ))}
                  </div>
                  {summary.overview && <p className="text-sm text-slate-700">{summary.overview}</p>}
                  {summary.takeaways.length > 0 && (
                    <div className="space-y-1.5 rounded-lg bg-slate-50 p-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Takeaways</h3>
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
                        What it covers ({summary.points.length})
                      </h3>
                      {summary.points.map((p, i) => (
                        <div key={i} className="border-l-2 border-indigo-100 pl-3">
                          <p className="text-sm font-semibold text-slate-900">{p.heading}</p>
                          {p.detail && <p className="mt-0.5 text-sm text-slate-700">{p.detail}</p>}
                          <Citations
                            ordinals={p.segmentOrdinals}
                            starts={segmentStarts}
                            url={view.linkTimestamps ? source.canonicalUrl : null}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  {summary.steps.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Steps</h3>
                      <ol className="list-decimal space-y-1.5 pl-5">
                        {summary.steps.map((st, i) => (
                          <li key={i} className="text-sm text-slate-800">
                            {st.text}
                            <Citations
                              ordinals={st.segmentOrdinals}
                              starts={segmentStarts}
                              url={view.linkTimestamps ? source.canonicalUrl : null}
                            />
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {summary.limits.length > 0 && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Not covered</h3>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                        {summary.limits.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {coverage && coverage.droppedPoints.length > 0 && (
                    <p className="text-xs text-amber-700">
                      {coverage.droppedPoints.length} claim{coverage.droppedPoints.length === 1 ? " was" : "s were"} left
                      out: no source in the transcript.
                    </p>
                  )}
                </div>
              )}
            </Section>
          )}

          {/* A manual's own table of contents; from here it builds its topics. */}
          {isDocument && version && (
            <Section
              title={`Table of contents${sections.length ? ` (${sections.length})` : ""}`}
              action={
                sections.length > 0 && source.docType === "manual" && source.moduleId ? (
                  moduleTopics > 0 ? (
                    <Link href={`/library/topics/${source.moduleId}`} className="btn-ghost py-1.5">
                      {moduleName} topics →
                    </Link>
                  ) : (
                    <form action={proposeTreeFromSource} className="flex items-center gap-2">
                      <input type="hidden" name="sourceId" value={source.id} />
                      <select name="maxDepth" defaultValue="1" className="field w-auto py-1.5 text-xs">
                        <option value="1">Chapters ({sections.filter((x) => x.level === 1).length})</option>
                        <option value="2">Two levels ({sections.filter((x) => x.level <= 2).length})</option>
                      </select>
                      <SubmitButton className="btn py-1.5" pendingLabel="Building…">
                        Build {moduleName} topics
                      </SubmitButton>
                    </form>
                  )
                ) : null
              }
            >
              {sections.length === 0 ? (
                <EmptyState>No table of contents in this file.</EmptyState>
              ) : (
                <>
                  {(source.docType !== "manual" || !source.moduleId) && (
                    <p className="text-xs text-amber-700">
                      Set it to Manual and choose its module (Details) to build topics from it.
                    </p>
                  )}
                  <ol className="card max-h-96 space-y-0.5 overflow-y-auto text-xs">
                    {sections.map((sec) => (
                      <li key={sec.id} className="flex gap-2" style={{ paddingLeft: `${(sec.level - 1) * 1}rem` }}>
                        <span className="w-12 shrink-0 text-slate-400">{sec.path}</span>
                        <span className="text-slate-800">{sec.title}</span>
                        <span className="ml-auto shrink-0 text-slate-400">
                          {sec.page != null ? `p.${sec.page}` : ""}
                          {sec.topic ? ` · ${sec.topic.title}` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </Section>
          )}

          {view.showChanges && diffRevision && (
            <Section title={changes.length ? `What changed (${changes.length})` : "What changed"}>
              {changes.length === 0 ? (
                <EmptyState>No changes from the previous version.</EmptyState>
              ) : (
                <div className="card space-y-3">
                  {changeCoverage && (
                    <p className="text-xs text-slate-400">{changeCoverage.unchanged} paragraphs unchanged</p>
                  )}
                  {changes.slice(0, 60).map((c: any, i: number) => (
                    <div key={i} className="border-l-2 border-slate-200 pl-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {c.kind === "changed" ? "Reworded" : c.kind === "added" ? "Added" : "Removed"}
                        {c.page ? ` · page ${c.page}` : ""}
                      </p>
                      {c.kind === "changed" ? (
                        <>
                          <p className="text-sm text-rose-700 line-through decoration-rose-300">{c.before}</p>
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
                    <p className="text-xs text-slate-400">First 60 of {changes.length}.</p>
                  )}
                </div>
              )}
            </Section>
          )}

          {isPage && preview && (
            <Section title="Preview (not stored)">
              <div className="card space-y-2">
                <p className="text-sm font-semibold text-slate-900">{preview.title}</p>
                <p className="text-xs text-slate-400">{preview.paragraphs} paragraphs</p>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-700">
                  {preview.textSample}
                </pre>
              </div>
            </Section>
          )}

          <Section
            title={`${view.contentsHeading}${version ? ` (${version._count.segments} ${view.unitWord})` : ""}`}
          >
            {!version ? (
              <EmptyState>Nothing stored yet.</EmptyState>
            ) : (
              <>
                <div className="card divide-y divide-slate-100">
                  {segments.map((s) => (
                    <p key={s.id} className="flex gap-3 py-1.5 text-sm">
                      {!view.isVideo ? (
                        <span className="shrink-0 font-mono text-xs text-slate-400">{s.page ? `p${s.page}` : "—"}</span>
                      ) : !view.linkTimestamps ? (
                        <span className="shrink-0 font-mono text-xs text-slate-500">{formatTimestamp(s.startMs)}</span>
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
                    First {segments.length} of {version._count.segments}.
                  </p>
                )}
              </>
            )}
          </Section>
        </div>

        {/* ---- Side panel ------------------------------------------------- */}
        <SidePanel>
          {finding && (
            <Link href={`/research/${finding.id}`} className="card block space-y-1 p-3 hover:border-indigo-300">
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Inbox item</span>
                <span className={`chip ${RELEVANCE_STYLES[finding.relevance] ?? ""}`}>
                  {RELEVANCE_LABELS[finding.relevance] ?? finding.relevance}
                </span>
              </span>
              <span className="block text-sm text-indigo-700">
                {finding.status === "pending" ? "Waiting for review" : finding.status === "approved" ? "Approved" : "Dismissed"} →
              </span>
            </Link>
          )}

          <PanelBox title="Details">
            <form action={setSourceClassification} className="space-y-2">
              <input type="hidden" name="sourceId" value={source.id} />
              <label className="label">
                What is it?
                <select name="docType" defaultValue={source.docType ?? ""} className="field mt-1 py-1.5">
                  <option value="">Not set</option>
                  {DOC_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              {isDocument && (
                <label className="label">
                  Module
                  <select name="moduleId" defaultValue={source.moduleId ?? ""} className="field mt-1 py-1.5">
                    <option value="">—</option>
                    {modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {version && (
                <label className="label">
                  Release{isDocument && versions.length > 1 ? ` (version ${version.version})` : ""}
                  <input
                    name="release"
                    defaultValue={version.release ?? ""}
                    placeholder="unknown"
                    list="source-release-suggestions"
                    className="field mt-1 py-1.5"
                  />
                  <datalist id="source-release-suggestions">
                    {RELEASE_SUGGESTIONS.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </label>
              )}
              <SubmitButton className="btn-ghost w-full py-1.5" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </form>
          </PanelBox>

          {filedTopics.length > 0 && (
            <PanelBox title="Filed under">
              <ul className="space-y-0.5">
                {filedTopics.map((t) => (
                  <li key={t.id}>
                    <Link href={`/library/topics/${t.moduleId}#${t.id}`} className="text-indigo-700 hover:underline">
                      {t.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </PanelBox>
          )}

          {affected.length > 0 && (
            <PanelBox title="Affects">
              <div className="flex flex-wrap gap-1.5">
                {affected.map((c) => (
                  <Link
                    key={c.id}
                    href={`/clients/${c.id}`}
                    className="chip border-slate-200 bg-white text-slate-700 hover:border-indigo-300"
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </Link>
                ))}
              </div>
            </PanelBox>
          )}

          {(isDocument || isPage) && versions.length > 0 && (
            <PanelBox title="Versions">
              <ul className="space-y-0.5 text-xs text-slate-600">
                {versions.map((v) => (
                  <li key={v.id} className="flex justify-between gap-2">
                    <span className={v.id === version?.id ? "font-medium text-slate-900" : ""}>
                      Version {v.version}
                      {v.release ? ` · ${v.release}` : ""}
                    </span>
                    <span className="text-slate-400">{formatDate(v.acquiredAt)}</span>
                  </li>
                ))}
              </ul>
            </PanelBox>
          )}

          {/* The run log, collapsed unless something went wrong. */}
          <Advanced label="What it did" open={stopped}>
            {job && (
              <p className="text-xs text-slate-500">
                {jobKindLabel(job.kind)} · {formatPence(job.spentMicroUsd)} this run · {formatPence(totalMicroUsd)} in
                total
              </p>
            )}
            {steps.length > 0 && (
              <ol className="space-y-1 text-xs">
                {steps.map((step: any, i: number) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-1.5">
                    <span
                      className={
                        step.state === "stopped"
                          ? "text-rose-600"
                          : step.state === "running"
                            ? "text-indigo-600"
                            : "text-emerald-600"
                      }
                    >
                      {step.state === "stopped" ? "✗" : step.state === "running" ? "…" : "✓"}
                    </span>
                    <span className="font-medium text-slate-700">{STAGE_LABELS[step.stage] ?? step.stage}</span>
                    <span className="text-slate-400">{new Date(step.at).toLocaleTimeString()}</span>
                    {step.note && (
                      <span className={step.state === "stopped" ? "text-rose-700" : "text-slate-500"}>{step.note}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {paidRuns.length > 0 && (
              <ul className="space-y-0.5 text-xs text-slate-400">
                {paidRuns.map((j, i) => (
                  <li key={j.id}>
                    Run {i + 1}: {formatPence(j.spentMicroUsd)}
                    {j.calls.length > 0 && ` — ${j.calls.map((c) => `${c.stage} ${formatPence(c.costMicroUsd)}`).join(" · ")}`}
                  </li>
                ))}
              </ul>
            )}
            {fetchLog.length > 0 && (
              <ul className="space-y-0.5 text-xs">
                {fetchLog.map((entry: any, i: number) => (
                  <li key={i} className="break-all">
                    <span className={entry.outcome === "fetched" ? "text-emerald-700" : "text-amber-700"}>
                      {entry.outcome}
                    </span>{" "}
                    <span className="text-slate-500">{entry.url}</span>
                  </li>
                ))}
              </ul>
            )}
            {isPage && preview?.embeds?.length > 0 && (
              <div className="text-xs">
                <p className="font-medium text-slate-700">Embedded players (not opened)</p>
                <ul className="break-all text-slate-500">
                  {preview.embeds.map((e: string) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {isPage && preview?.notFollowed?.length > 0 && (
              <div className="text-xs">
                <p className="font-medium text-slate-700">Sites not followed</p>
                <ul className="text-slate-500">
                  {preview.notFollowed.map((n: any) => (
                    <li key={n.host}>
                      {n.host} ×{n.count}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {isPage && preview?.structure?.items?.length > 0 && (
              <div className="text-xs">
                <p className="font-medium text-slate-700">Page structure</p>
                <pre className="max-h-60 select-all overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-slate-600">
                  {JSON.stringify(preview.structure, null, 2)}
                </pre>
              </div>
            )}
            <p className="text-xs text-slate-400">
              Added {formatDate(source.createdAt)} · {source.externalId}
            </p>
          </Advanced>
        </SidePanel>
      </div>
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
  // null when the player can't jump to a second (a Tagetik webinar): the
  // timestamp is still shown, so the claim can be found in the transcript.
  url: string | null;
}) {
  const known = (ordinals ?? []).filter((o) => starts.has(o));
  if (known.length === 0) return null;
  if (!url) {
    return (
      <span className="mt-1 flex flex-wrap gap-2">
        {known.map((o) => (
          <span key={o} className="font-mono text-xs text-slate-500">
            {formatTimestamp(starts.get(o)!)}
          </span>
        ))}
      </span>
    );
  }
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
