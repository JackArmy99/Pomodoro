import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  updateAgent,
  appendBriefingFromFile,
  deleteAgent,
  addAgentSource,
  deleteAgentSource,
  runAgent,
} from "@/app/actions/agents";
import { formatDate, RELEVANCE_STYLES, RELEVANCE_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

function costLabel(cents: number): string {
  return `~£${(cents / 100).toFixed(2)}`;
}

export default async function AgentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const agent = await prisma.agent.findUnique({
    where: { id: params.id },
    include: {
      sources: { orderBy: { createdAt: "asc" } },
      runs: { orderBy: { ranAt: "desc" }, take: 8 },
      findings: {
        where: { status: "pending" },
        orderBy: { createdAt: "desc" },
        take: 8,
      },
    },
  });
  if (!agent) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/agents" className="text-xs text-indigo-600 hover:underline">
          ← All agents
        </Link>
        <div className="flex items-center gap-2">
          <form action={runAgent}>
            <input type="hidden" name="id" value={agent.id} />
            <button type="submit" className="btn">
              Run now
            </button>
          </form>
          <form action={deleteAgent}>
            <input type="hidden" name="id" value={agent.id} />
            <button
              type="submit"
              className="text-xs text-slate-400 hover:text-rose-600"
            >
              Delete
            </button>
          </form>
        </div>
      </div>

      {/* Identity + guardrails */}
      <form action={updateAgent} className="card space-y-3">
        <input type="hidden" name="id" value={agent.id} />
        <h2 className="text-sm font-semibold text-slate-900">Identity</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              name="name"
              defaultValue={agent.name}
              className="field"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="mission">
              Mission
            </label>
            <input
              id="mission"
              name="mission"
              defaultValue={agent.mission}
              className="field"
            />
          </div>
        </div>
        <h3 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Scope &amp; guardrails
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="allowedDomains">
              Only these domains{" "}
              <span className="font-normal text-slate-400">
                (comma-separated, optional)
              </span>
            </label>
            <input
              id="allowedDomains"
              name="allowedDomains"
              defaultValue={agent.allowedDomains ?? ""}
              placeholder="tagetik.com, wolterskluwer.com"
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="blockedDomains">
              Block these domains{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="blockedDomains"
              name="blockedDomains"
              defaultValue={agent.blockedDomains ?? ""}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="maxItems">
              Max items per run
            </label>
            <input
              id="maxItems"
              name="maxItems"
              type="number"
              min="1"
              max="20"
              defaultValue={agent.maxItems}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="lookbackDays">
              Look back (days)
            </label>
            <input
              id="lookbackDays"
              name="lookbackDays"
              type="number"
              min="1"
              max="365"
              defaultValue={agent.lookbackDays}
              className="field"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-ghost">
            Save
          </button>
        </div>
      </form>

      {/* Briefing — the driver */}
      <form action={updateAgent} className="card space-y-3">
        <input type="hidden" name="id" value={agent.id} />
        <h2 className="text-sm font-semibold text-slate-900">Briefing</h2>
        <p className="text-xs text-slate-500">
          What this agent looks for and how to summarise — this drives every run.
        </p>
        <textarea
          name="briefing"
          rows={6}
          defaultValue={agent.briefing}
          placeholder="e.g. Track CCH Tagetik product releases and roadmap. Prioritise new modules, pricing and end-of-support notices. Ignore marketing and events."
          className="field"
        />
        <div className="flex justify-end">
          <button type="submit" className="btn">
            Save briefing
          </button>
        </div>
      </form>

      {/* Upload a brief into the briefing */}
      <form
        action={appendBriefingFromFile}
        className="card flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="id" value={agent.id} />
        <div className="flex-1">
          <label className="label" htmlFor="brief-file">
            Append a PDF / Word brief to the briefing
          </label>
          <input
            id="brief-file"
            name="file"
            type="file"
            accept=".pdf,.docx,.txt"
            className="field"
          />
        </div>
        <button type="submit" className="btn-ghost">
          Append
        </button>
      </form>

      {/* Pinned sources (optional) */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Pinned sources{" "}
          <span className="font-normal text-slate-400">(optional)</span>
        </h2>
        {agent.sources.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {agent.sources.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="chip mr-2 border-slate-200 bg-slate-50 text-slate-500">
                    {s.type === "rss" ? "Feed" : "Topic"}
                  </span>
                  <span className="font-medium text-slate-800">{s.name}</span>
                  <span className="ml-2 truncate text-xs text-slate-400">
                    {s.type === "rss" ? s.url : s.query}
                  </span>
                </span>
                <form action={deleteAgentSource}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="agentId" value={agent.id} />
                  <button
                    type="submit"
                    className="text-xs text-slate-400 hover:text-rose-600"
                  >
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form
          action={addAgentSource}
          className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
        >
          <input type="hidden" name="agentId" value={agent.id} />
          <div>
            <label className="label" htmlFor="src-type">
              Type
            </label>
            <select id="src-type" name="type" className="field">
              <option value="web">Web topic</option>
              <option value="rss">RSS feed</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="src-name">
              Name
            </label>
            <input id="src-name" name="name" className="field" required />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="src-detail">
              Query (topic) or feed URL
            </label>
            {/* Both fields submitted; the action uses the one matching the type. */}
            <input
              id="src-detail"
              name="query"
              placeholder="search terms — for a Web topic"
              className="field"
            />
            <input
              name="url"
              placeholder="https://…/feed.xml — for an RSS feed"
              className="field mt-1"
            />
          </div>
          <button type="submit" className="btn-ghost">
            Add
          </button>
        </form>
      </section>

      {/* Recent findings */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Recent findings ({agent.findings.length})
        </h2>
        {agent.findings.length === 0 ? (
          <p className="card text-sm text-slate-500">
            Nothing pending. Hit “Run now”.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {agent.findings.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className={`chip ${RELEVANCE_STYLES[f.relevance]}`}>
                  {RELEVANCE_LABELS[f.relevance]}
                </span>
                <Link
                  href={`/research/${f.id}`}
                  className="truncate text-slate-800 hover:underline"
                >
                  {f.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Run history */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Run history</h2>
        {agent.runs.length === 0 ? (
          <p className="card text-sm text-slate-500">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {agent.runs.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <span className="text-slate-500">{formatDate(r.ranAt)}</span>
                <span className="text-slate-700">
                  {r.status === "error"
                    ? `Error — ${r.message ?? "failed"}`
                    : r.status === "nothing_new"
                      ? "Nothing new"
                      : `Found ${r.foundCount} · ${r.highCount} high / ${r.medCount} med / ${r.lowCount} low`}
                </span>
                <span className="text-slate-400">{costLabel(r.estCostCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
