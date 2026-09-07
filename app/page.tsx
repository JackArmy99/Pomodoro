import Link from "next/link";
import { prisma } from "@/lib/db";
import TaskForm from "@/components/forms/TaskForm";
import TaskItem from "@/components/TaskItem";
import { bucketTasks } from "@/lib/tasks";
import { STAGE_LABELS, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

const URGENCY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export default async function HomePage() {
  const [openTasks, doneCount, clients, openOpps, recentBriefs] =
    await Promise.all([
      prisma.task.findMany({
        where: { done: false },
        include: { client: true },
      }),
      prisma.task.count({ where: { done: true } }),
      prisma.client.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.opportunity.findMany({
        where: { stage: { in: ["open", "pursuing"] } },
        include: { client: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.brief.findMany({
        include: { clients: { include: { client: true } } },
        orderBy: { createdAt: "desc" },
        take: 4,
      }),
    ]);

  // Most urgent first, then earliest due date (undated last) — within each bucket.
  const sorted = [...openTasks].sort((a, b) => {
    const ur = (URGENCY_RANK[a.urgency] ?? 2) - (URGENCY_RANK[b.urgency] ?? 2);
    if (ur !== 0) return ur;
    const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return ad - bd;
  });
  const buckets = bucketTasks(sorted);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold text-slate-900">Your tasks</h1>
          <span className="text-xs text-slate-400">
            {openTasks.length} open · {doneCount} done
          </span>
        </div>
        <p className="text-sm text-slate-500">
          Your day, week and month at a glance. Tick “Book in Teams” once a task
          is scheduled in your calendar.
        </p>
      </section>

      <TaskForm clients={clients} />

      <section className="space-y-6">
        {buckets.length === 0 ? (
          <p className="card text-sm text-slate-500">
            No open tasks. Add one above — nice and clear. 🎉
          </p>
        ) : (
          buckets.map((bucket) => (
            <div key={bucket.key} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-700">
                  {bucket.label}
                </h2>
                <span className="chip border-slate-200 bg-slate-100 text-slate-500">
                  {bucket.tasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {bucket.tasks.map((t) => (
                  <TaskItem key={t.id} task={t} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* The layer on top: keep opportunities and briefs in view. */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Open opportunities
            </h2>
            <Link
              href="/opportunities"
              className="text-xs text-indigo-600 hover:underline"
            >
              View pipeline →
            </Link>
          </div>
          {openOpps.length === 0 ? (
            <p className="card text-sm text-slate-500">None open.</p>
          ) : (
            <ul className="space-y-2">
              {openOpps.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-800">{o.title}</p>
                    <p className="text-xs text-slate-400">
                      {o.client ? o.client.name : "No client"} ·{" "}
                      {STAGE_LABELS[o.stage] ?? o.stage}
                      {o.value ? ` · ${formatMoney(o.value)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Latest briefs
            </h2>
            <Link
              href="/briefs"
              className="text-xs text-indigo-600 hover:underline"
            >
              View all →
            </Link>
          </div>
          {recentBriefs.length === 0 ? (
            <p className="card text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentBriefs.map((b) => (
                <li
                  key={b.id}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                >
                  <p className="truncate text-sm text-slate-800">{b.title}</p>
                  <p className="truncate text-xs text-slate-400">
                    {b.clients.length > 0
                      ? b.clients.map((bc) => bc.client.name).join(", ")
                      : "Unassigned"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
