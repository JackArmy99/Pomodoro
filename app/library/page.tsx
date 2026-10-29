import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  submitVideo,
  submitDocument,
  submitPage,
  scanLibrary,
  watchLibraryItem,
  dismissLibraryItem,
} from "@/app/actions/knowledge";
import { webinarShortlist } from "@/lib/knowledge/shortlist";
import { errorAdvice, libraryStatus } from "@/lib/knowledge/format";
import { portalEnabled } from "@/lib/portal/enabled";
import { workerLooksAlive } from "@/lib/knowledge/sources";
import { formatTimestamp } from "@/lib/research/video/youtube";
import SubmitButton from "@/components/SubmitButton";
import AutoRefresh from "@/components/AutoRefresh";
import { formatDate } from "@/lib/format";
import { DOC_TYPES, RELEASE_SUGGESTIONS, docTypeLabel } from "@/lib/knowledge/authority";
import { PageHeader, Tabs, StatusChip, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const TABS = ["topics", "videos", "manuals", "pages"] as const;
type Tab = (typeof TABS)[number];
const VIDEO_KINDS = ["youtube", "portal_video"];

// Everything Beacon has learned, one tab per kind.
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: { error?: string; tab?: string };
}) {
  const tab: Tab = (TABS as readonly string[]).includes(searchParams.tab ?? "")
    ? (searchParams.tab as Tab)
    : "topics";

  const [sources, workerAlive, portalOn, { shortlist, lastScan, lastGood, scanning }, modules, topicCounts] = await Promise.all([
    prisma.knowledgeSource.findMany({
      // The Library listing is a source only so its checks have a history.
      where: { kind: { not: "library" } },
      orderBy: { createdAt: "desc" },
      include: {
        jobs: { orderBy: { createdAt: "desc" }, take: 1 },
        versions: { orderBy: { version: "asc" }, select: { release: true } },
      },
    }),
    workerLooksAlive(),
    portalEnabled(),
    webinarShortlist(),
    prisma.module.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.kbTopic.groupBy({ by: ["moduleId", "status"], _count: true }),
  ]);

  const videos = sources.filter((s) => VIDEO_KINDS.includes(s.kind));
  const documents = sources.filter((s) => s.kind === "document");
  const pages = sources.filter((s) => s.kind === "page");

  // ---- Topics: modules that have a tree or a manual.
  const topicsOf = (moduleId: string, status?: string) =>
    topicCounts
      .filter((t) => t.moduleId === moduleId && (!status || t.status === status))
      .reduce((n, t) => n + t._count, 0);
  const manualFor = (moduleId: string) =>
    documents.find((d) => d.docType === "manual" && d.moduleId === moduleId) ?? null;
  const kbModules = modules.filter((m) => topicsOf(m.id) > 0 || manualFor(m.id));

  const anyPending =
    scanning || sources.some((s) => ["queued", "running", "retry_wait"].includes(s.jobs[0]?.state ?? ""));

  const tabs = [
    { key: "topics", label: "Topics", count: kbModules.length },
    { key: "videos", label: "Webinars & videos", count: videos.length },
    { key: "manuals", label: "Manuals", count: documents.length },
    { key: "pages", label: "Pages", count: pages.length },
  ];

  return (
    <div className="space-y-5">
      <AutoRefresh active={anyPending} />
      <PageHeader title="Library" />

      {searchParams.error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{searchParams.error}</p>
      )}
      {anyPending && !workerAlive && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          The worker isn&apos;t running, so queued items will wait. Restart Beacon with <code>npm run dev</code>.
        </p>
      )}

      <Tabs tabs={tabs} active={tab} base="/library" />

      {tab === "topics" &&
        (kbModules.length === 0 ? (
          <EmptyState
            action={
              <Link href="/library?tab=manuals" className="btn-ghost">
                Upload a manual
              </Link>
            }
          >
            No topics yet — they are built from a module&apos;s manual.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {kbModules.map((m) => {
              const total = topicsOf(m.id);
              const drafts = topicsOf(m.id, "draft");
              const manual = manualFor(m.id);
              const href = total > 0 ? `/library/topics/${m.id}` : manual ? `/library/${manual.id}` : "/library?tab=manuals";
              return (
                <li key={m.id}>
                  <Link href={href} className="card block space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{m.name}</span>
                      {total > 0 ? (
                        <StatusChip tone={drafts ? "amber" : "green"}>
                          {drafts ? `${drafts} to approve` : "Approved"}
                        </StatusChip>
                      ) : (
                        <StatusChip tone="blue">Build topics</StatusChip>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {total ? `${total} topics` : "No topics yet"}
                      {manual ? ` · ${manual.title}` : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}

      {tab === "videos" && (
        <>
          <div className="card flex flex-wrap items-end gap-2">
            <form action={submitVideo} className="flex min-w-0 flex-1 items-end gap-2">
              <input
                name="url"
                placeholder="YouTube or Tagetik Community webinar link"
                className="field"
                required
              />
              <SubmitButton className="btn whitespace-nowrap" pendingLabel="Adding…">
                Add a video
              </SubmitButton>
            </form>
            {portalOn ? (
              <form action={scanLibrary}>
                <SubmitButton className="btn-ghost whitespace-nowrap" pendingLabel="Checking…">
                  {scanning ? "Checking…" : "Check for new webinars"}
                </SubmitButton>
              </form>
            ) : (
              <Link href="/settings" className="text-xs text-amber-700 hover:underline">
                Tagetik Community access is off — Settings
              </Link>
            )}
          </div>

          {lastScan && !scanning && lastScan.state !== "succeeded" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              The last check didn&apos;t finish: {errorAdvice(lastScan.errorCode, lastScan.errorMessage, lastScan.kind)}
            </p>
          )}

          {shortlist.length > 0 && (
            <section className="card space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">New Tagetik webinars</h2>
                {lastGood && (
                  <span className="text-xs text-slate-400">
                    checked {formatDate(lastGood.finishedAt ?? lastGood.createdAt)}
                  </span>
                )}
              </div>
              <ul className="divide-y divide-slate-100">
                {shortlist.map((item) => (
                  <li key={item.key} className="flex flex-wrap items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-400">{item.dateText}</p>
                    </div>
                    <form action={watchLibraryItem}>
                      <input type="hidden" name="url" value={item.url} />
                      <SubmitButton className="btn py-1.5" pendingLabel="Queueing…">
                        Watch this webinar
                      </SubmitButton>
                    </form>
                    <form action={dismissLibraryItem}>
                      <input type="hidden" name="key" value={item.key} />
                      <button type="submit" className="btn-ghost py-1.5 text-xs">
                        Not interested
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <SourceList
            rows={videos}
            empty={portalOn ? "No videos yet — Check for new webinars, or add a link." : "No videos yet — add a link."}
            detail={(s) => [
              s.kind === "portal_video" ? "Webinar" : "YouTube",
              s.durationMs ? formatTimestamp(s.durationMs) : null,
            ]}
          />
        </>
      )}

      {tab === "manuals" && (
        <>
          <form action={submitDocument} className="card space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="label sm:col-span-3">
                File (PDF or Word)
                <input name="file" type="file" accept=".pdf,.docx,.txt,.md" className="field mt-1" required />
              </label>
              <label className="label">
                What is it?
                <select name="docType" className="field mt-1" required defaultValue="manual">
                  {DOC_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                Module
                <select name="moduleId" className="field mt-1" defaultValue="">
                  <option value="">—</option>
                  {modules.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                Release
                <input name="release" placeholder="e.g. 2025" list="doc-release-suggestions" className="field mt-1" />
                <datalist id="doc-release-suggestions">
                  {RELEASE_SUGGESTIONS.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </label>
              {documents.length > 0 && (
                <label className="label sm:col-span-3">
                  Newer edition of
                  <select name="versionOf" className="field mt-1" defaultValue="">
                    <option value="">— (a new document)</option>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="flex justify-end">
              <SubmitButton className="btn whitespace-nowrap" pendingLabel="Uploading…">
                Upload a manual
              </SubmitButton>
            </div>
          </form>

          <SourceList
            rows={documents}
            empty="No manuals yet — upload one above."
            detail={(s) => [
              docTypeLabel(s.docType),
              modules.find((m) => m.id === s.moduleId)?.name ?? null,
              s.versions.length > 1
                ? `${s.versions.length} editions · ${s.versions.map((v) => v.release ?? "?").join(" → ")}`
                : s.versions[0]?.release
                  ? `release ${s.versions[0].release}`
                  : null,
            ]}
          />
        </>
      )}

      {tab === "pages" && (
        <>
          {portalOn ? (
            <form action={submitPage} className="card space-y-2">
              <div className="flex items-end gap-2">
                <input name="url" type="url" placeholder="https://community.tagetik.com/…" className="field" required />
                <SubmitButton className="btn whitespace-nowrap" pendingLabel="Queueing…">
                  Watch a page
                </SubmitButton>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" name="dryRun" defaultChecked />
                Preview only (store nothing)
              </label>
            </form>
          ) : (
            <EmptyState
              action={
                <Link href="/settings" className="btn-ghost">
                  Settings
                </Link>
              }
            >
              Tagetik Community access is off.
            </EmptyState>
          )}
          <SourceList rows={pages} empty="No pages watched yet." detail={() => ["Page"]} />
        </>
      )}
    </div>
  );
}

type Row = {
  id: string;
  title: string;
  canonicalUrl: string;
  kind: string;
  createdAt: Date;
  jobs: { state: string }[];
};

function SourceList<T extends Row>({
  rows,
  empty,
  detail,
}: {
  rows: T[];
  empty: string;
  detail: (s: T) => (string | null)[];
}) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="card divide-y divide-slate-100 p-0">
      {rows.map((s) => {
        const st = libraryStatus(s.jobs[0]?.state, s.kind);
        return (
          <li key={s.id}>
            <Link href={`/library/${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                {s.title || s.canonicalUrl}
              </span>
              <span className="text-xs text-slate-400">{detail(s).filter(Boolean).join(" · ")}</span>
              <span className="text-xs text-slate-400">{formatDate(s.createdAt)}</span>
              <StatusChip tone={st.tone}>{st.label}</StatusChip>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
