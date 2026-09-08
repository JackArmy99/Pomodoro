import { prisma } from "@/lib/db";
import { hasApiKey } from "@/lib/anthropic";
import {
  approveFinding,
  createBrief,
  createSource,
  createWebTopic,
  deleteBrief,
  deleteSource,
  dismissFinding,
  fetchNow,
  fetchOneSource,
  ingestPaste,
  ingestVideo,
  runBrief,
  saveInstructions,
  summariseFinding,
} from "@/app/actions/research";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const [findings, sources, instructionsSetting, briefs] = await Promise.all([
    prisma.finding.findMany({
      where: { status: "pending" },
      include: { modules: { include: { module: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.source.findMany({ orderBy: { name: "asc" } }),
    prisma.setting.findUnique({ where: { key: "research_instructions" } }),
    prisma.researchBrief.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  const aiOn = hasApiKey();
  const instructions = instructionsSetting?.value ?? "";
  const rssSources = sources.filter((s) => s.type !== "web");
  const webSources = sources.filter((s) => s.type === "web");

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

      {/* What the agents look for */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          What the agents look for
        </h2>
        <p className="text-xs text-slate-500">
          Tell the summariser, in your own words, what to prioritise and what to
          ignore. This steers every summary and module suggestion.
        </p>
        <form action={saveInstructions} className="space-y-2">
          <textarea
            name="instructions"
            rows={4}
            defaultValue={instructions}
            placeholder="e.g. Prioritise regulatory changes affecting Consolidation and ESG. Flag new modules, pricing changes, and end-of-support notices. Ignore marketing and events."
            className="field"
          />
          <div className="flex justify-end">
            <button type="submit" className="btn-ghost">
              Save instructions
            </button>
          </div>
        </form>
      </section>

      {/* Research briefs — the driver */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Research briefs</h2>
        <p className="text-xs text-slate-500">
          Give the agents a brief to work from — upload a <strong>PDF</strong> or{" "}
          <strong>Word</strong> file, or type it in. Press <strong>Run</strong>{" "}
          and they research the wider internet against it, dropping results in the
          inbox.
        </p>

        {briefs.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {briefs.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {b.name}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {b.lastRunAt
                      ? `Last run ${formatDate(b.lastRunAt)}`
                      : "Not run yet"}
                    {" · "}
                    {b.content.length.toLocaleString()} chars
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <form action={runBrief}>
                    <input type="hidden" name="id" value={b.id} />
                    <button type="submit" className="btn">
                      Run
                    </button>
                  </form>
                  <form action={deleteBrief}>
                    <input type="hidden" name="id" value={b.id} />
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
          action={createBrief}
          className="space-y-3 border-t border-slate-100 pt-3"
        >
          <div>
            <label className="label" htmlFor="brief-name">
              Brief name
            </label>
            <input
              id="brief-name"
              name="name"
              placeholder="e.g. Weekly EPM market scan"
              className="field"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="brief-file">
              Upload a PDF or Word file
            </label>
            <input
              id="brief-file"
              name="file"
              type="file"
              accept=".pdf,.docx,.txt"
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="brief-content">
              …or type the brief
            </label>
            <textarea
              id="brief-content"
              name="content"
              rows={4}
              placeholder="What should the agents research? Scope, priorities, competitors, modules, questions to answer…"
              className="field"
            />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="btn-ghost">
              Save brief
            </button>
          </div>
        </form>
      </section>

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

      {/* Video */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Add a video</h2>
        <p className="text-xs text-slate-500">
          Paste a <strong>YouTube</strong> link — the caption track is pulled and
          summarised. (Videos without captions need the audio/ASR path, coming
          next.)
        </p>
        <form action={ingestVideo} className="flex items-end gap-2">
          <div className="flex-1">
            <input
              name="url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              className="field"
              required
            />
          </div>
          <button type="submit" className="btn">
            Add video
          </button>
        </form>
      </section>

      {/* Web research topics */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Web research topics
        </h2>
        <p className="text-xs text-slate-500">
          Give the agent a topic and it searches the wider internet each run
          (via Claude), dropping what it finds into the inbox. Uses your API key
          plus a small web-search cost per run.
        </p>
        {webSources.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {webSources.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {s.name}
                  </p>
                  <p className="truncate text-xs text-slate-400">“{s.query}”</p>
                  {s.lastFetchedAt && (
                    <p className="text-[11px] text-slate-400">
                      Last run {formatDate(s.lastFetchedAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <form action={fetchOneSource}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" className="btn-ghost py-1">
                      Run
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
          action={createWebTopic}
          className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
        >
          <div className="flex-1">
            <label className="label" htmlFor="wt-name">
              Topic name
            </label>
            <input
              id="wt-name"
              name="name"
              placeholder="e.g. Competitor EPM launches"
              className="field"
              required
            />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="wt-query">
              What to search for
            </label>
            <input
              id="wt-query"
              name="query"
              placeholder="e.g. OneStream / Anaplan new features 2026"
              className="field"
              required
            />
          </div>
          <button type="submit" className="btn-ghost">
            Add topic
          </button>
        </form>
      </section>

      {/* RSS Sources */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            RSS feeds ({rssSources.length})
          </h2>
          <form action={fetchNow}>
            <button type="submit" className="btn">
              Fetch now
            </button>
          </form>
        </div>
        <p className="text-xs text-slate-500">
          “Fetch now” runs every active feed <em>and</em> web topic.
        </p>

        {rssSources.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {rssSources.map((s) => (
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
          <div className="w-full">
            <label className="label" htmlFor="src-instructions">
              Notes for this source{" "}
              <span className="font-normal text-slate-400">(optional steering)</span>
            </label>
            <input
              id="src-instructions"
              name="instructions"
              placeholder="e.g. This is the ESG product blog — focus on CSRD/ESRS changes."
              className="field"
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
