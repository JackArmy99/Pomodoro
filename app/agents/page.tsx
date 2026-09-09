import Link from "next/link";
import { prisma } from "@/lib/db";
import { hasApiKey, isTestMode } from "@/lib/anthropic";
import {
  createAgent,
  runAgent,
  runAllAgents,
  researchNow,
  setTestMode,
} from "@/app/actions/agents";
import SubmitButton from "@/components/SubmitButton";
import { RELEVANCE_STYLES } from "@/lib/format";

export const dynamic = "force-dynamic";

function costLabel(cents: number): string {
  return `~£${(cents / 100).toFixed(2)}`;
}

export default async function AgentsPage() {
  const [agents, pending, runs, costAgg, testMode] = await Promise.all([
    prisma.agent.findMany({
      where: { archetype: "finder" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.finding.findMany({
      where: { status: "pending" },
      select: {
        id: true,
        agentId: true,
        relevance: true,
        title: true,
        sourceUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.agentRun.findMany({ orderBy: { ranAt: "desc" } }),
    prisma.agentRun.aggregate({ _sum: { estCostCents: true } }),
    isTestMode(),
  ]);

  const lastRun = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!lastRun.has(r.agentId)) lastRun.set(r.agentId, r);

  const needsAttention = pending.filter((f) => f.relevance === "high").slice(0, 6);
  const totalCost = costAgg._sum.estCostCents ?? 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Agents</h1>
          <p className="text-sm text-slate-500">
            Your research team. Each agent works to its briefing; findings land
            in the inbox, scored by relevance.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <TestModeToggle on={testMode} />
            <form action={runAllAgents}>
              <SubmitButton pendingLabel="Researching…">Run all</SubmitButton>
            </form>
          </div>
          <span className="text-xs text-slate-400">
            Spent on research so far: {costLabel(totalCost)}
          </span>
        </div>
      </header>

      {!hasApiKey() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>AI is off.</strong> Add <code>ANTHROPIC_API_KEY</code> to your{" "}
          <code>.env</code> and restart for agents to research and score.
        </div>
      )}

      {/* Needs attention */}
      {needsAttention.length > 0 && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <h2 className="mb-2 text-sm font-semibold text-rose-800">
            Needs attention
          </h2>
          <ul className="space-y-1.5">
            {needsAttention.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <span className="chip border-rose-200 bg-rose-100 text-rose-700">
                  High
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
          <Link
            href="/research"
            className="mt-2 inline-block text-xs font-medium text-rose-700 hover:underline"
          >
            Open inbox →
          </Link>
        </section>
      )}

      {/* Ad-hoc research */}
      <section className="card space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Research now</h2>
        <p className="text-xs text-slate-500">
          A one-off search — no saved agent. Type a topic or drop in a
          PDF/Word file; results go to the inbox.
        </p>
        <form action={researchNow} className="space-y-2">
          <div className="flex items-end gap-2">
            <input
              name="query"
              placeholder="e.g. Latest OneStream acquisition news"
              className="field"
            />
            <SubmitButton
              className="btn-ghost whitespace-nowrap"
              pendingLabel="Researching…"
            >
              Research
            </SubmitButton>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="whitespace-nowrap">or research a file:</span>
            <input
              name="file"
              type="file"
              accept=".pdf,.docx,.txt"
              className="field py-1.5 text-xs"
            />
          </div>
        </form>
      </section>

      {/* Agents */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Your agents</h2>
        {agents.length === 0 ? (
          <p className="card text-sm text-slate-500">
            No agents yet. Create one below.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {agents.map((a) => {
              const mine = pending.filter((f) => f.agentId === a.id);
              const high = mine.filter((f) => f.relevance === "high").length;
              const med = mine.filter((f) => f.relevance === "medium").length;
              const low = mine.filter((f) => f.relevance === "low").length;
              const lr = lastRun.get(a.id);
              const lastLabel = !lr
                ? "Not run yet"
                : lr.status === "error"
                  ? "Error — check agent"
                  : lr.status === "nothing_new"
                    ? "Nothing new"
                    : `Found ${lr.foundCount}`;
              return (
                <div
                  key={a.id}
                  className="card group hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lift"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/agents/${a.id}`}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-ink transition duration-200 ease-apple hover:text-accent"
                      >
                        {a.name}
                        <span
                          aria-hidden
                          className="text-slate-400 transition duration-200 ease-apple group-hover:translate-x-0.5 group-hover:text-accent"
                        >
                          ›
                        </span>
                      </Link>
                      {a.mission && (
                        <p className="truncate text-xs text-slate-500">
                          {a.mission}
                        </p>
                      )}
                    </div>
                    <form action={runAgent}>
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton
                        className="btn py-1"
                        pendingLabel="Researching…"
                      >
                        Run
                      </SubmitButton>
                    </form>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="chip border-slate-200 bg-slate-100 text-slate-600">
                      {mine.length} pending
                    </span>
                    {high > 0 && (
                      <span className={`chip ${RELEVANCE_STYLES.high}`}>
                        {high} high
                      </span>
                    )}
                    {med > 0 && (
                      <span className={`chip ${RELEVANCE_STYLES.medium}`}>
                        {med} med
                      </span>
                    )}
                    {low > 0 && (
                      <span className={`chip ${RELEVANCE_STYLES.low}`}>
                        {low} low
                      </span>
                    )}
                    <span className="ml-auto text-slate-400">{lastLabel}</span>
                  </div>
                  {/* Explicit Configure action: the briefing, research briefs
                      and guardrails all live on the agent's own page. */}
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <Link
                      href={`/agents/${a.id}`}
                      className="btn-ghost w-full justify-center"
                    >
                      Configure
                      <span aria-hidden className="ml-1">
                        →
                      </span>
                    </Link>
                    <p className="mt-1.5 text-center text-[11px] text-slate-400">
                      Briefing, research briefs &amp; guardrails
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* New agent */}
        <form
          action={createAgent}
          className="card flex flex-wrap items-end gap-2"
        >
          <div className="flex-1">
            <label className="label" htmlFor="agent-name">
              New agent name
            </label>
            <input
              id="agent-name"
              name="name"
              placeholder="e.g. Regulatory & ESG Monitor"
              className="field"
              required
            />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="agent-mission">
              Mission (one line)
            </label>
            <input
              id="agent-mission"
              name="mission"
              placeholder="Watch CSRD/ESRS and IFRS changes"
              className="field"
            />
          </div>
          <input type="hidden" name="archetype" value="finder" />
          <button type="submit" className="btn-ghost">
            Create
          </button>
          <p className="w-full text-xs text-slate-400">
            Create an agent, then open <strong className="font-medium text-slate-500">Configure</strong>{" "}
            to set its briefing, guardrails and research briefs.
          </p>
        </form>
      </section>
    </div>
  );
}

// A persisted on/off switch for cheap "Test mode" (Haiku + fewer searches).
// Server component: the button posts the opposite of the current state.
function TestModeToggle({ on }: { on: boolean }) {
  return (
    <form action={setTestMode} className="flex items-center">
      <input type="hidden" name="on" value={on ? "false" : "true"} />
      <button
        type="submit"
        title={
          on
            ? "Test mode ON — Haiku, ~2 searches (~2–3p/run). Click for full Sonnet runs."
            : "Full mode — Sonnet, up to 5 searches. Click for cheap Haiku test runs."
        }
        className={`chip transition duration-200 ease-apple ${
          on
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${
            on ? "bg-emerald-500" : "bg-slate-300"
          }`}
        />
        {on ? "Test mode: on" : "Test mode: off"}
      </button>
    </form>
  );
}
