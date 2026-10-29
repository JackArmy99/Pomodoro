import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  submitVideo,
  submitDocument,
  submitPage,
  togglePortal,
  scanLibrary,
  watchLibraryItem,
  dismissLibraryItem,
} from "@/app/actions/knowledge";
import { parseDetail } from "@/lib/knowledge/runLog";
import { DISMISSED_KEY, type LibraryItem } from "@/lib/portal/library";
import { errorAdvice } from "@/lib/knowledge/format";
import { portalEnabled } from "@/lib/portal/enabled";
import { workerLooksAlive } from "@/lib/knowledge/sources";
import { JOB_STATE_LABELS, JOB_STATE_STYLES } from "@/lib/knowledge/format";
import { formatTimestamp } from "@/lib/research/video/youtube";
import SubmitButton from "@/components/SubmitButton";
import AutoRefresh from "@/components/AutoRefresh";
import { formatDate } from "@/lib/format";
import { DOC_TYPES, RELEASE_SUGGESTIONS, docTypeLabel } from "@/lib/knowledge/authority";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const [sources, workerAlive, portalOn, library, dismissedRow] = await Promise.all([
    prisma.knowledgeSource.findMany({
      // The Library listing is a source only so its checks have a history; it
      // isn't knowledge, so it isn't listed with the videos and documents.
      where: { kind: { not: "library" } },
      orderBy: { createdAt: "desc" },
      include: {
        jobs: { orderBy: { createdAt: "desc" }, take: 1 },
        versions: {
          orderBy: { version: "asc" },
          select: {
            release: true,
            _count: { select: { segments: true } },
            revisions: { where: { status: "published" }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
    workerLooksAlive(),
    portalEnabled(),
    prisma.knowledgeSource.findFirst({
      where: { kind: "library" },
      include: { jobs: { orderBy: { createdAt: "desc" }, take: 5 } },
    }),
    prisma.setting.findUnique({ where: { key: DISMISSED_KEY } }),
  ]);
  const modules = await prisma.module.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  // ---- The webinar shortlist ------------------------------------------------
  // The latest check's list, joined against what Beacon already holds and what
  // Jack dismissed — worked out now, so it is never stale.
  const lastScan = library?.jobs[0] ?? null;
  const scanning = !!lastScan && ["queued", "running", "retry_wait"].includes(lastScan.state);
  const lastGood = library?.jobs.find((j) => j.state === "succeeded") ?? null;
  const items = (parseDetail(lastGood?.detail).items ?? []) as LibraryItem[];
  let dismissed = new Set<string>();
  try {
    dismissed = new Set(JSON.parse(dismissedRow?.value ?? "[]"));
  } catch {
    dismissed = new Set();
  }
  const held = items.length
    ? await prisma.knowledgeSource.findMany({
        where: { provider: "tagetik", externalId: { in: items.map((i) => i.key) } },
        include: { jobs: { orderBy: { createdAt: "desc" }, take: 1 } },
      })
    : [];
  const heldByKey = new Map(held.map((h) => [h.externalId, h]));
  const shown = items.filter((i) => !dismissed.has(i.key));
  const hiddenCount = items.length - shown.length;

  const documents = sources.filter((x) => x.kind === "document");

  const anyPending =
    scanning ||
    sources.some((s) => ["queued", "running", "retry_wait"].includes(s.jobs[0]?.state ?? ""));

  return (
    <div className="space-y-6">
      <AutoRefresh active={anyPending} />
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Knowledge</h1>
        <p className="text-sm text-slate-500">
          Videos Beacon has read. The full transcript is kept — the summary is
          not the knowledge base.
        </p>
      </header>

      {searchParams.error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {searchParams.error}
        </p>
      )}

      {/* A queued job with no worker is a silent dead end — say so. */}
      {anyPending && !workerAlive && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>The research worker isn&apos;t running.</strong> Jobs will sit
          queued until it starts. Stop the app and run <code>npm run dev</code>,
          which starts the worker alongside it. (If you started with{" "}
          <code>npm run dev:app</code>, that one runs the app only.)
        </div>
      )}

      {/* Jack chooses what is watched: the Library's own Asset Type filter
          (Webinars), then he ticks. Nothing is downloaded until he does. */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Tagetik webinars</h2>
            <p className="text-xs text-slate-500">
              Newest from the Library, filtered to Asset Type: Webinars. Nothing is
              downloaded until you press <strong>Watch this</strong>. Each one takes
              about half its length to transcribe on this laptop, plus ~10p for the
              summary (under 1p in test mode).
            </p>
          </div>
          {portalOn && (
            <form action={scanLibrary}>
              <SubmitButton className="whitespace-nowrap" pendingLabel="Queueing…">
                {scanning ? "Checking…" : "Check for new webinars"}
              </SubmitButton>
            </form>
          )}
        </div>

        {!portalOn && (
          <p className="text-xs text-amber-800">Switch portal access on (below) to check the Library.</p>
        )}
        {lastScan && !scanning && lastScan.state !== "succeeded" && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            The last check didn&apos;t finish:{" "}
            {errorAdvice(lastScan.errorCode, lastScan.errorMessage, lastScan.kind)}
          </p>
        )}
        {lastGood && (
          <p className="text-xs text-slate-400">
            Last checked {formatDate(lastGood.finishedAt ?? lastGood.createdAt)} ·{" "}
            {items.length} listed
            {hiddenCount > 0 ? ` · ${hiddenCount} you said no to are hidden` : ""}
          </p>
        )}

        {shown.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {shown.map((item) => {
              const have = heldByKey.get(item.key);
              const state = have?.jobs[0]?.state ?? null;
              const status = !have
                ? "new"
                : ["queued", "running", "retry_wait"].includes(state ?? "")
                  ? "working"
                  : state === "succeeded"
                    ? "watched"
                    : "attention";
              return (
                <li key={item.key} className="flex flex-wrap items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-400">{item.dateText}</p>
                    <p className="text-sm font-medium text-slate-900">{item.title}</p>
                    {item.description && (
                      <p className="line-clamp-2 text-xs text-slate-500">{item.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {status === "new" ? (
                      <>
                        <form action={watchLibraryItem}>
                          <input type="hidden" name="url" value={item.url} />
                          <SubmitButton pendingLabel="Queueing…">Watch this</SubmitButton>
                        </form>
                        <form action={dismissLibraryItem}>
                          <input type="hidden" name="key" value={item.key} />
                          <button type="submit" className="btn-ghost text-xs">
                            Not interested
                          </button>
                        </form>
                      </>
                    ) : (
                      <Link
                        href={`/knowledge/${have!.id}`}
                        className={`chip ${
                          status === "watched"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : status === "working"
                              ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                              : "border-amber-200 bg-amber-50 text-amber-800"
                        }`}
                      >
                        {status === "watched"
                          ? "Watched ✓"
                          : status === "working"
                            ? "In progress…"
                            : "Needs attention"}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form action={submitVideo} className="card space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Add a video</h2>
        <p className="text-xs text-slate-500">
          Paste a YouTube link, or a Tagetik Community webinar page (one with a
          Watch button). Processing runs in the background and can take a few
          minutes — you don&apos;t need to wait on this page.
        </p>
        <div className="flex items-end gap-2">
          <input
            name="url"
            placeholder="https://www.youtube.com/watch?v=…"
            className="field"
            required
          />
          <SubmitButton className="whitespace-nowrap" pendingLabel="Queueing…">
            Research
          </SubmitButton>
        </div>
      </form>

      <Link
        href="/knowledge/base"
        className="card flex items-center justify-between hover:border-indigo-300"
      >
        <span>
          <span className="text-sm font-semibold text-slate-900">Knowledge base</span>
          <span className="block text-xs text-slate-500">
            Module → topic trees built from the manuals. Import a manual below, then build its tree.
          </span>
        </span>
        <span className="text-sm text-indigo-600">Open →</span>
      </Link>

      <form action={submitDocument} className="card space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Add a document</h2>
        <p className="text-xs text-slate-500">
          A manual, release note or spec (PDF or Word). It is stored page by page
          and costs nothing to import — no AI is used until you ask a question or
          ask what changed. Upload a newer version with the same file name and
          Beacon will show you exactly what changed.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-slate-500">
            <span>File</span>
            <input
              name="file"
              type="file"
              accept=".pdf,.docx,.txt,.md"
              className="field"
              required
            />
          </label>
          <label className="space-y-1 text-xs text-slate-500">
            <span>What is it?</span>
            {/* Sets how much it may say in the knowledge base: only a Manual
                can write manual content; everything else only adds to it. */}
            <select name="docType" className="field" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {DOC_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-slate-500">
            <span>Tagetik release it covers (if known)</span>
            <input
              name="release"
              placeholder="e.g. 2025"
              list="doc-release-suggestions"
              className="field"
            />
            <datalist id="doc-release-suggestions">
              {RELEASE_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
          <label className="space-y-1 text-xs text-slate-500">
            <span>Module it covers (for a manual)</span>
            <select name="moduleId" className="field" defaultValue="">
              <option value="">—</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-slate-500">
            <span>A new edition of an existing document?</span>
            <select name="versionOf" className="field" defaultValue="">
              <option value="">No — a new document</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Two editions of one manual: import the <strong>older</strong> one first,
          then the newer one as &ldquo;a new edition&rdquo; of it.
        </p>
        <div className="flex justify-end">
          <SubmitButton className="whitespace-nowrap" pendingLabel="Uploading…">
            Import
          </SubmitButton>
        </div>
      </form>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Watch a Tagetik page
            </h2>
            <p className="text-xs text-slate-500">
              Sign in once with <code>npm run portal:login</code> — your password
              never reaches Beacon. Re-checking a page that hasn&apos;t changed
              costs nothing, so it is cheap to watch often.
            </p>
          </div>
          <form action={togglePortal}>
            <input type="hidden" name="on" value={portalOn ? "false" : "true"} />
            <button
              type="submit"
              className={`chip ${portalOn ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}
            >
              {portalOn ? "Portal access: on" : "Portal access: off"}
            </button>
          </form>
        </div>

        {!portalOn && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Switching this on confirms that automated access is permitted under
            your agreement with Wolters Kluwer. Nothing is fetched until it is on.
          </p>
        )}

        <form action={submitPage} className="space-y-2">
          <div className="flex items-end gap-2">
            <input
              name="url"
              type="url"
              placeholder="https://community.tagetik.com/…"
              className="field"
              required
            />
            <SubmitButton className="whitespace-nowrap" pendingLabel="Queueing…">
              Watch page
            </SubmitButton>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" name="dryRun" defaultChecked />
            Preview first — read the page and show the text, store nothing
          </label>
        </form>
      </section>

      {sources.length === 0 ? (
        <p className="card text-sm text-slate-500">
          No videos yet. Paste a link above to build the knowledge base.
        </p>
      ) : (
        <ul className="space-y-2">
          {sources.map((s) => {
            const job = s.jobs[0];
            const segments = s.versions.reduce(
              (n, v) => n + v._count.segments,
              0,
            );
            const summarised = s.versions.some((v) => v.revisions.length > 0);
            return (
              <li key={s.id}>
                <Link href={`/knowledge/${s.id}`} className="card block">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`chip ${JOB_STATE_STYLES[job?.state ?? "queued"]}`}
                    >
                      {JOB_STATE_LABELS[job?.state ?? "queued"]}
                    </span>
                    {s.durationMs ? (
                      <span className="chip border-slate-200 bg-slate-50 text-slate-600">
                        {formatTimestamp(s.durationMs)}
                      </span>
                    ) : null}
                    {segments > 0 && (
                      <span className="text-xs text-slate-400">
                        {segments} transcript segments
                      </span>
                    )}
                    <span
                      className={`chip ${
                        s.docType
                          ? "border-slate-200 bg-slate-50 text-slate-600"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      {docTypeLabel(s.docType)}
                    </span>
                    {s.kind === "document" && s.versions.length > 0 && (
                      <span className="text-xs text-slate-400">
                        {s.versions.length === 1 ? "1 edition" : `${s.versions.length} editions`}
                        {" · release "}
                        {s.versions.map((v) => v.release ?? "?").join(" → ")}
                      </span>
                    )}
                    {segments > 0 && !summarised && (
                      <span className="chip border-slate-200 bg-slate-50 text-slate-500">
                        Not summarised
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400">
                      {formatDate(s.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {s.title || s.canonicalUrl}
                  </p>
                  {s.channel && (
                    <p className="text-xs text-slate-500">{s.channel}</p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
