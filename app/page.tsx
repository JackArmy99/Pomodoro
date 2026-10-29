import Link from "next/link";
import { prisma } from "@/lib/db";
import TaskForm from "@/components/forms/TaskForm";
import TaskItem from "@/components/TaskItem";
import { bucketTasks } from "@/lib/tasks";
import { webinarShortlist } from "@/lib/knowledge/shortlist";
import { formatDate } from "@/lib/format";
import { PageHeader, Section, StatusChip } from "@/components/ui";

export const dynamic = "force-dynamic";

const URGENCY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

// What needs me: counts that click through, what each agent did, my tasks.
export default async function HomePage() {
  const [openTasks, clients, inboxCount, draftTopics, failedItems, agents, { shortlist }] = await Promise.all([
    prisma.task.findMany({ where: { done: false }, include: { client: true } }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.finding.count({ where: { status: "pending" } }),
    prisma.kbTopic.groupBy({ by: ["moduleId"], where: { status: "draft" }, _count: true }),
    // Only items whose LATEST run stopped short — a retried success is fine.
    prisma.knowledgeSource
      .findMany({
        where: { kind: { not: "library" } },
        select: { jobs: { orderBy: { createdAt: "desc" }, take: 1, select: { state: true } } },
      })
      .then((rows) => rows.filter((r) => ["failed", "needs_input"].includes(r.jobs[0]?.state ?? "")).length),
    prisma.agent.findMany({
      where: { archetype: "finder" },
      orderBy: { name: "asc" },
      include: { runs: { orderBy: { ranAt: "desc" }, take: 1 } },
    }),
    webinarShortlist(),
  ]);

  const sorted = [...openTasks].sort((a, b) => {
    const ur = (URGENCY_RANK[a.urgency] ?? 2) - (URGENCY_RANK[b.urgency] ?? 2);
    if (ur !== 0) return ur;
    const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return ad - bd;
  });
  const buckets = bucketTasks(sorted);
  const drafts = draftTopics.reduce((n, d) => n + d._count, 0);

  const waiting = [
    { n: inboxCount, label: inboxCount === 1 ? "inbox item to review" : "inbox items to review", href: "/research" },
    { n: drafts, label: drafts === 1 ? "topic to approve" : "topics to approve", href: "/library?tab=topics" },
    { n: shortlist.length, label: shortlist.length === 1 ? "new webinar on the shortlist" : "new webinars on the shortlist", href: "/library?tab=videos" },
    { n: failedItems, label: failedItems === 1 ? "Library item needs you" : "Library items need you", href: "/library?tab=videos" },
  ].filter((w) => w.n > 0);

  return (
    <div className="space-y-8">
      <PageHeader title="Home" />

      <Section title="Waiting for you">
        {waiting.length === 0 ? (
          <p className="card text-sm text-slate-500">Nothing waiting.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {waiting.map((w) => (
              <li key={w.label}>
                <Link href={w.href} className="card flex items-center gap-3 py-3">
                  <span className="text-2xl font-semibold text-indigo-700">{w.n}</span>
                  <span className="text-sm text-slate-700">{w.label} →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Agents" action={<Link href="/agents" className="text-xs text-indigo-600 hover:underline">All agents →</Link>}>
        {agents.length === 0 ? (
          <p className="card text-sm text-slate-500">No agents yet.</p>
        ) : (
          <ul className="card divide-y divide-slate-100 p-0">
            {agents.map((a) => {
              const run = a.runs[0];
              const result = !run
                ? { label: "Never run", tone: "grey" as const }
                : run.status === "running"
                  ? { label: "Running…", tone: "blue" as const }
                  : run.status === "error"
                    ? { label: "Failed — open", tone: "red" as const }
                    : run.foundCount > 0
                      ? { label: `${run.foundCount} new`, tone: "green" as const }
                      : { label: "Nothing new", tone: "grey" as const };
              return (
                <li key={a.id}>
                  <Link href={`/agents/${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{a.name}</span>
                    <span className="text-xs text-slate-400">{run ? formatDate(run.ranAt) : ""}</span>
                    <StatusChip tone={result.tone}>{result.label}</StatusChip>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={`My tasks (${openTasks.length})`}>
        <TaskForm clients={clients} />
        {buckets.length === 0 ? (
          <p className="card text-sm text-slate-500">No open tasks.</p>
        ) : (
          <div className="space-y-5">
            {buckets.map((bucket) => (
              <div key={bucket.key} className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">
                  {bucket.label} <span className="font-normal text-slate-400">({bucket.tasks.length})</span>
                </h3>
                <div className="space-y-2">
                  {bucket.tasks.map((t) => (
                    <TaskItem key={t.id} task={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
