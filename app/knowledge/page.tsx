import Link from "next/link";
import { prisma } from "@/lib/db";
import { submitVideo } from "@/app/actions/knowledge";
import { workerLooksAlive } from "@/lib/knowledge/sources";
import { JOB_STATE_LABELS, JOB_STATE_STYLES } from "@/lib/knowledge/format";
import { formatTimestamp } from "@/lib/research/video/youtube";
import SubmitButton from "@/components/SubmitButton";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const [sources, workerAlive] = await Promise.all([
    prisma.knowledgeSource.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        jobs: { orderBy: { createdAt: "desc" }, take: 1 },
        versions: { select: { _count: { select: { segments: true } } } },
      },
    }),
    workerLooksAlive(),
  ]);

  const anyPending = sources.some((s) =>
    ["queued", "running", "retry_wait"].includes(s.jobs[0]?.state ?? ""),
  );

  return (
    <div className="space-y-6">
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
          queued until you start it. Open a second terminal in the project folder
          and run <code>npm run worker</code> — or use{" "}
          <code>npm run dev:all</code> next time to start both together.
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
