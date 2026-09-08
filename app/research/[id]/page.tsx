import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  updateFinding,
  digDeeper,
  dismissFinding,
  finalizeApprove,
  summariseFinding,
} from "@/app/actions/research";
import {
  formatDate,
  RELEVANCE_STYLES,
  RELEVANCE_LABELS,
  MODULE_STATUS_LABELS,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FindingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const finding = await prisma.finding.findUnique({
    where: { id: params.id },
    include: {
      modules: { include: { module: true } },
      agent: { select: { name: true } },
    },
  });
  if (!finding) notFound();

  const allModules = await prisma.module.findMany({ orderBy: { name: "asc" } });
  const currentModuleIds = new Set(finding.modules.map((m) => m.moduleId));

  // Affected clients = those holding any of the finding's tagged modules.
  const moduleIds = finding.modules.map((m) => m.moduleId);
  const links = moduleIds.length
    ? await prisma.clientModule.findMany({
        where: { moduleId: { in: moduleIds } },
        include: { client: true, module: true },
      })
    : [];
  const byClient = new Map<
    string,
    { client: { id: string; name: string }; matches: string[] }
  >();
  for (const l of links) {
    const e = byClient.get(l.clientId) ?? { client: l.client, matches: [] };
    e.matches.push(`${l.module.name} (${MODULE_STATUS_LABELS[l.status]})`);
    byClient.set(l.clientId, e);
  }
  const affected = Array.from(byClient.values()).sort((a, b) =>
    a.client.name.localeCompare(b.client.name),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/research" className="text-xs text-indigo-600 hover:underline">
          ← Inbox
        </Link>
        <div className="flex items-center gap-2">
          {!finding.aiProcessed && (
            <form action={summariseFinding}>
              <input type="hidden" name="id" value={finding.id} />
              <button type="submit" className="btn-ghost py-1">
                Summarise
              </button>
            </form>
          )}
          <form action={dismissFinding}>
            <input type="hidden" name="id" value={finding.id} />
            <button
              type="submit"
              className="text-xs text-slate-400 hover:text-rose-600"
            >
              Dismiss
            </button>
          </form>
        </div>
      </div>

      <header>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className={`chip ${RELEVANCE_STYLES[finding.relevance]}`}>
            {RELEVANCE_LABELS[finding.relevance]}
          </span>
          <span className="chip border-slate-200 bg-slate-50 text-slate-600">
            {finding.agent ? finding.agent.name : "Manual"}
          </span>
          <span className="text-xs text-slate-400">
            {formatDate(finding.publishedAt ?? finding.createdAt)}
          </span>
        </div>
        <h1 className="text-lg font-semibold text-slate-900">{finding.title}</h1>
        {finding.sourceUrl && (
          <a
            href={finding.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            Source ↗
          </a>
        )}
      </header>

      {/* Edit */}
      <form action={updateFinding} className="card space-y-3">
        <input type="hidden" name="id" value={finding.id} />
        <h2 className="text-sm font-semibold text-slate-900">Review &amp; edit</h2>
        <div>
          <label className="label" htmlFor="summary">
            Summary
          </label>
          <textarea
            id="summary"
            name="summary"
            rows={6}
            defaultValue={finding.summary}
            className="field"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="relevance">
              Relevance
            </label>
            <select
              id="relevance"
              name="relevance"
              defaultValue={finding.relevance}
              className="field"
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="moduleIds">
              Modules{" "}
              <span className="font-normal text-slate-400">
                (drives affected clients; Ctrl/Cmd-click)
              </span>
            </label>
            <select
              id="moduleIds"
              name="moduleIds"
              multiple
              size={Math.min(Math.max(allModules.length, 3), 6)}
              defaultValue={allModules
                .filter((m) => currentModuleIds.has(m.id))
                .map((m) => m.id)}
              className="field"
            >
              {allModules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-ghost">
            Save changes
          </button>
        </div>
      </form>

      {/* Dig deeper */}
      <form action={digDeeper} className="card space-y-2">
        <input type="hidden" name="id" value={finding.id} />
        <h2 className="text-sm font-semibold text-slate-900">Dig deeper</h2>
        <p className="text-xs text-slate-500">
          Send the agent back to research more and enrich the summary above.
          Optionally steer it.
        </p>
        <div className="flex items-end gap-2">
          <input
            name="note"
            placeholder="e.g. focus on pricing and rollout dates"
            className="field"
          />
          <button type="submit" className="btn-ghost whitespace-nowrap">
            Dig deeper
          </button>
        </div>
      </form>

      {/* Approve → fan out to clients */}
      <form action={finalizeApprove} className="card space-y-3">
        <input type="hidden" name="id" value={finding.id} />
        <h2 className="text-sm font-semibold text-slate-900">
          Approve → create items
        </h2>
        <p className="text-xs text-slate-500">
          Approving files this as a Brief. Tick the affected clients below to
          also create an item for each (default: Opportunity).
        </p>

        {moduleIds.length === 0 ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No modules tagged yet — add some above and save, then affected
            clients will appear here. You can still approve to file the brief.
          </p>
        ) : affected.length === 0 ? (
          <p className="text-xs text-slate-500">
            No clients hold the tagged module(s).
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {affected.map(({ client, matches }) => (
              <li
                key={client.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="clientIds"
                    value={client.id}
                    className="h-4 w-4"
                  />
                  <span className="font-medium text-slate-800">
                    {client.name}
                  </span>
                  <span className="text-xs text-slate-400">
                    {matches.join(", ")}
                  </span>
                </label>
                <select
                  name={`type_${client.id}`}
                  defaultValue="opportunity"
                  className="field w-40 py-1"
                >
                  <option value="opportunity">Opportunity</option>
                  <option value="task">Task</option>
                  <option value="brief">Brief only</option>
                </select>
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <button type="submit" className="btn">
            Approve
          </button>
        </div>
      </form>
    </div>
  );
}
