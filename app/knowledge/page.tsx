import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  submitVideo,
  submitDocument,
  submitPage,
  togglePortal,
} from "@/app/actions/knowledge";
import { portalEnabled } from "@/lib/portal/enabled";
import { workerLooksAlive } from "@/lib/knowledge/sources";
import { JOB_STATE_LABELS, JOB_STATE_STYLES } from "@/lib/knowledge/format";
import { formatTimestamp } from "@/lib/research/video/youtube";
import SubmitButton from "@/components/SubmitButton";
import AutoRefresh from "@/components/AutoRefresh";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const [sources, workerAlive, portalOn] = await Promise.all([
    prisma.knowledgeSource.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        jobs: { orderBy: { createdAt: "desc" }, take: 1 },
        versions: {
          select: {
            _count: { select: { segments: true } },
            revisions: { where: { status: "published" }, select: { id: true }, take: 1 },
          },
        },
      },
    }),
    workerLooksAlive(),
    portalEnabled(),
  ]);

  const anyPending = sources.some((s) =>
    ["queued", "running", "retry_wait"].includes(s.jobs[0]?.state ?? ""),
  );

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

      <form action={submitVideo} className="card space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Add a video</h2>
        <p className="text-xs text-slate-500">
          Paste a YouTube link. Processing runs in the background and can take a
          few minutes — you don&apos;t need to wait on this page.
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

      <form action={submitDocument} className="card space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Add a document</h2>
        <p className="text-xs text-slate-500">
          A manual, release note or spec (PDF or Word). It is stored page by page
          and costs nothing to import — no AI is used until you ask a question or
          ask what changed. Upload a newer version with the same file name and
          Beacon will show you exactly what changed.
        </p>
        <div className="flex items-end gap-2">
          <input
            name="file"
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="field"
            required
          />
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
