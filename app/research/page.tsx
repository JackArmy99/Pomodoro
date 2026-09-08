import Link from "next/link";
import { prisma } from "@/lib/db";
import { hasApiKey } from "@/lib/anthropic";
import { ingestPaste, ingestVideo, dismissFinding } from "@/app/actions/research";
import {
  formatDate,
  RELEVANCE_STYLES,
  RELEVANCE_LABELS,
  RELEVANCE_RANK,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ResearchInboxPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  const agentFilter = searchParams.agent;

  const [findingsRaw, agents] = await Promise.all([
    prisma.finding.findMany({
      where: {
        status: "pending",
        ...(agentFilter
          ? agentFilter === "none"
            ? { agentId: null }
            : { agentId: agentFilter }
          : {}),
      },
      include: {
        modules: { include: { module: true } },
        agent: { select: { id: true, name: true } },
      },
    }),
    prisma.agent.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Sort: highest relevance first, then newest.
  const findings = [...findingsRaw].sort((a, b) => {
    const r = (RELEVANCE_RANK[a.relevance] ?? 1) - (RELEVANCE_RANK[b.relevance] ?? 1);
    if (r !== 0) return r;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Research inbox</h1>
        <p className="text-sm text-slate-500">
          What the agents found, most relevant first. Review each one, then
          approve into briefs/opportunities or dismiss.
        </p>
      </header>

      {!hasApiKey() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>AI is off.</strong> Add <code>ANTHROPIC_API_KEY</code> to your{" "}
          <code>.env</code> and restart for summaries and scoring.
        </div>
      )}

      {/* Agent filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Agent:</span>
        <FilterChip href="/research" active={!agentFilter}>
          All
        </FilterChip>
        {agents.map((a) => (
          <FilterChip
            key={a.id}
            href={`/research?agent=${a.id}`}
            active={agentFilter === a.id}
          >
            {a.name}
          </FilterChip>
        ))}
        <FilterChip href="/research?agent=none" active={agentFilter === "none"}>
          Manual / ad-hoc
        </FilterChip>
      </div>

      {/* Findings */}
      {findings.length === 0 ? (
        <p className="card text-sm text-slate-500">
          Nothing waiting. Run an agent from the <Link href="/agents" className="text-indigo-600 hover:underline">Agents</Link> page, or add something below.
        </p>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => (
            <article key={f.id} className="card">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className={`chip ${RELEVANCE_STYLES[f.relevance]}`}>
                  {RELEVANCE_LABELS[f.relevance]}
                </span>
                <span className="chip border-slate-200 bg-slate-50 text-slate-600">
                  {f.agent ? f.agent.name : "Manual"}
                </span>
                <span className="text-xs text-slate-400">
                  {formatDate(f.publishedAt ?? f.createdAt)}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900">
                <Link href={`/research/${f.id}`} className="hover:underline">
                  {f.title}
                </Link>
              </h3>
              {(f.summary || f.rawContent) && (
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">
                  {f.summary || f.rawContent.slice(0, 300)}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {f.modules.map((fm) => (
                  <span
                    key={fm.moduleId}
                    className="chip border-indigo-100 bg-indigo-50 text-indigo-600"
                  >
                    {fm.module.name}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Link href={`/research/${f.id}`} className="btn py-1">
                  Review →
                </Link>
                <form action={dismissFinding}>
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" className="btn-ghost py-1">
                    Dismiss
                  </button>
                </form>
                {f.sourceUrl && (
                  <a
                    href={f.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-xs font-medium text-indigo-600 hover:underline"
                  >
                    Source ↗
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Manual quick-adds */}
      <section className="grid gap-4 md:grid-cols-2">
        <form action={ingestPaste} className="card space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">Paste an item</h2>
          <p className="text-xs text-slate-500">
            For login-gated text: copy it here and it goes through the same
            summarise → inbox flow.
          </p>
          <input name="title" placeholder="Title" className="field" required />
          <textarea
            name="content"
            rows={3}
            placeholder="Paste the text…"
            className="field"
          />
          <input name="sourceUrl" type="url" placeholder="Source URL (optional)" className="field" />
          <div className="flex justify-end">
            <button type="submit" className="btn">
              Add
            </button>
          </div>
        </form>

        <form action={ingestVideo} className="card space-y-2">
          <h2 className="text-sm font-semibold text-slate-900">Add a video</h2>
          <p className="text-xs text-slate-500">
            Paste a YouTube link — its captions are summarised into the inbox.
          </p>
          <input
            name="url"
            type="url"
            placeholder="https://www.youtube.com/watch?v=…"
            className="field"
            required
          />
          <div className="flex justify-end">
            <button type="submit" className="btn">
              Add video
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`chip ${
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );
}
