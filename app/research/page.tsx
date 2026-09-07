import { prisma } from "@/lib/db";
import { hasApiKey } from "@/lib/anthropic";
import {
  approveFinding,
  createSource,
  deleteSource,
  dismissFinding,
  fetchNow,
  fetchOneSource,
  ingestPaste,
  summariseFinding,
} from "@/app/actions/research";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const [findings, sources] = await Promise.all([
    prisma.finding.findMany({
      where: { status: "pending" },
      include: { modules: { include: { module: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.source.findMany({ orderBy: { name: "asc" } }),
  ]);

  const aiOn = hasApiKey();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Research inbox</h1>
        <p className="text-sm text-slate-500">
          New items from your sources land here. Review, then approve into a
          brief (module tags carry over) or dismiss.
        </p>
      </header>

      {!aiOn && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>AI summaries are off.</strong> Add{" "}
          <code className="rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code> to
          your <code className="rounded bg-amber-100 px-1">.env</code> file and
          restart to have items summarised automatically. Items still work
          without it — they just show the raw text.
        </div>
      )}

      {/* Inbox */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            Pending ({findings.length})
          </h2>
        </div>
        {findings.length === 0 ? (
          <p className="card text-sm text-slate-500">
            Nothing waiting. Add a source and hit “Fetch now”, or paste something
            below.
          </p>
        ) : (
          findings.map((f) => (
            <article key={f.id} className="card">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="chip border-slate-200 bg-slate-50 text-slate-600">
                  {f.sourceType === "paste" ? "Pasted" : "Feed"}
                </span>
                <span className="text-xs text-slate-400">
                  {formatDate(f.publishedAt ?? f.createdAt)}
                </span>
                {!f.aiProcessed && (
                  <span className="text-xs text-amber-600">not summarised</span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-600">
                {f.summary || f.rawContent.slice(0, 400) || "(no content)"}
              </p>

              {f.modules.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {f.modules.map((fm) => (
                    <span
                      key={fm.moduleId}
                      className="chip border-indigo-100 bg-indigo-50 text-indigo-600"
                    >
                      {fm.module.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <form action={approveFinding}>
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" className="btn">
                    Approve → Brief
                  </button>
                </form>
                <form action={dismissFinding}>
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" className="btn-ghost">
                    Dismiss
                  </button>
                </form>
                {aiOn && !f.aiProcessed && (
                  <form action={summariseFinding}>
                    <input type="hidden" name="id" value={f.id} />
                    <button type="submit" className="btn-ghost">
                      Summarise
                    </button>
                  </form>
                )}
                {f.sourceUrl && (
                  <a
                    href={f.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-xs font-medium text-indigo-600 hover:underline"
                  >
                    View source ↗
                  </a>
                )}
              </div>
            </article>
          ))
        )}
      </section>

      {/* Paste bridge */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Paste an item</h2>
        <p className="text-xs text-slate-500">
          For anything behind a login (release notes, manuals): copy the text and
          paste it here — it goes through the same summarise → inbox flow.
        </p>
        <form action={ingestPaste} className="space-y-3">
          <input
            name="title"
            placeholder="Title"
            className="field"
            required
          />
          <textarea
            name="content"
            rows={4}
            placeholder="Paste the release-note / article text here…"
            className="field"
          />
          <input
            name="sourceUrl"
            type="url"
            placeholder="Source URL (optional)"
            className="field"
          />
          <div className="flex justify-end">
            <button type="submit" className="btn">
              Add to inbox
            </button>
          </div>
        </form>
      </section>

      {/* Sources */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Sources ({sources.length})
          </h2>
          <form action={fetchNow}>
            <button type="submit" className="btn">
              Fetch now
            </button>
          </form>
        </div>

        {sources.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {sources.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {s.name}
                  </p>
                  <p className="truncate text-xs text-slate-400">{s.url}</p>
                  {s.lastFetchedAt && (
                    <p className="text-[11px] text-slate-400">
                      Last fetched {formatDate(s.lastFetchedAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <form action={fetchOneSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" className="btn-ghost py-1">
                      Fetch
                    </button>
                  </form>
                  <form action={deleteSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <button
                      type="submit"
                      className="text-xs text-slate-400 hover:text-rose-600"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          action={createSource}
          className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
        >
          <div className="flex-1">
            <label className="label" htmlFor="src-name">
              Add an RSS / blog feed
            </label>
            <input
              id="src-name"
              name="name"
              placeholder="Name (e.g. Vendor blog)"
              className="field"
              required
            />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="src-url">
              Feed URL
            </label>
            <input
              id="src-url"
              name="url"
              type="url"
              placeholder="https://…/feed.xml"
              className="field"
              required
            />
          </div>
          <button type="submit" className="btn-ghost">
            Add source
          </button>
        </form>
      </section>
    </div>
  );
}
