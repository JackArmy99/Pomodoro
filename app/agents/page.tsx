import Link from "next/link";
import { prisma } from "@/lib/db";
import { hasApiKey } from "@/lib/anthropic";
import { createAgent, runAgent, runAllAgents, researchNow } from "@/app/actions/agents";
import SubmitButton from "@/components/SubmitButton";
import AutoRefresh from "@/components/AutoRefresh";
import { formatDate } from "@/lib/format";
import { PageHeader, Section, StatusChip, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

function costLabel(cents: number): string {
  return `~£${(cents / 100).toFixed(2)}`;
}

export default async function AgentsPage() {
  const [agents, pending, runs, costAgg] = await Promise.all([
    prisma.agent.findMany({ where: { archetype: "finder" }, orderBy: { createdAt: "asc" } }),
    prisma.finding.groupBy({ by: ["agentId"], where: { status: "pending" }, _count: true }),
    prisma.agentRun.findMany({ orderBy: { ranAt: "desc" } }),
    prisma.agentRun.aggregate({ _sum: { estCostCents: true } }),
  ]);

  const lastRun = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!lastRun.has(r.agentId)) lastRun.set(r.agentId, r);
  const anyRunning = runs.some((r) => r.status === "running");
  const pendingFor = (id: string) => pending.find((p) => p.agentId === id)?._count ?? 0;

  return (
    <div className="space-y-6">
      <AutoRefresh active={anyRunning} />
      <PageHeader
        title="Agents"
        action={
          <>
            <span className="text-xs text-slate-400">Spent so far {costLabel(costAgg._sum.estCostCents ?? 0)}</span>
            <form action={runAllAgents}>
              <SubmitButton pendingLabel="Starting…">Run all</SubmitButton>
            </form>
          </>
        }
      />

      {!hasApiKey() && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          AI is off: add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart.
        </p>
      )}

      {agents.length === 0 ? (
        <EmptyState>No agents yet — create one below.</EmptyState>
      ) : (
        <ul className="card divide-y divide-slate-100 p-0">
          {agents.map((a) => {
            const lr = lastRun.get(a.id);
            const running = lr?.status === "running";
            const result = !lr
              ? { label: "Never run", tone: "grey" as const }
              : running
                ? { label: "Running…", tone: "blue" as const }
                : lr.status === "error"
                  ? { label: "Failed — open", tone: "red" as const }
                  : lr.foundCount > 0
                    ? { label: `${lr.foundCount} new`, tone: "green" as const }
                    : { label: "Nothing new", tone: "grey" as const };
            const waiting = pendingFor(a.id);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/agents/${a.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900 hover:text-indigo-700">
                    {a.name}
                  </span>
                  <span className="text-xs text-slate-400">{lr ? `Last run ${formatDate(lr.ranAt)}` : "Not run yet"}</span>
                </Link>
                {waiting > 0 && (
                  <Link href={`/research?agent=${a.id}`} className="text-xs text-indigo-600 hover:underline">
                    {waiting} in the inbox
                  </Link>
                )}
                <StatusChip tone={result.tone}>{result.label}</StatusChip>
                <form action={runAgent}>
                  <input type="hidden" name="id" value={a.id} />
                  <SubmitButton className="btn-ghost py-1.5" pendingLabel="Starting…" disabled={running}>
                    {running ? "Running…" : "Run now"}
                  </SubmitButton>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <Section title="New agent">
        <form action={createAgent} className="card flex flex-wrap items-end gap-2">
          <input name="name" placeholder="Name, e.g. Regulatory & ESG" className="field min-w-0 flex-1" required />
          <input type="hidden" name="archetype" value="finder" />
          <SubmitButton className="btn-ghost" pendingLabel="Creating…">
            Create agent
          </SubmitButton>
        </form>
      </Section>

      <Section title="One-off research">
        <form action={researchNow} className="card flex flex-wrap items-end gap-2">
          <input name="query" placeholder="A topic, e.g. OneStream acquisition news" className="field min-w-0 flex-1" />
          <input name="file" type="file" accept=".pdf,.docx,.txt" className="field w-auto py-1.5 text-xs" />
          <SubmitButton className="btn-ghost whitespace-nowrap" pendingLabel="Researching…">
            Research now
          </SubmitButton>
        </form>
      </Section>
    </div>
  );
}
