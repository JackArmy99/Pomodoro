import Link from "next/link";
import { prisma } from "@/lib/db";
import { hasApiKey } from "@/lib/anthropic";
import { ingestPaste, dismissFinding, finalizeApprove } from "@/app/actions/research";
import SubmitButton from "@/components/SubmitButton";
import { isVerifiedCurrent } from "@/lib/research/revision";
import { formatDate, RELEVANCE_STYLES, RELEVANCE_LABELS, RELEVANCE_RANK } from "@/lib/format";
import { PageHeader, StatusChip, EmptyState, Advanced } from "@/components/ui";

export const dynamic = "force-dynamic";

type Search = { agent?: string; status?: string; relevance?: string; module?: string };

const STATUSES = [
  { value: "pending", label: "To review" },
  { value: "approved", label: "Approved" },
  { value: "dismissed", label: "Dismissed" },
];

// One row per inbox item; Approve / Dismiss right on the row once checked.
export default async function InboxPage({ searchParams }: { searchParams: Search }) {
  const status = STATUSES.some((s) => s.value === searchParams.status) ? searchParams.status! : "pending";
  const agentFilter = searchParams.agent ?? "";
  const relevance = ["high", "medium", "low"].includes(searchParams.relevance ?? "") ? searchParams.relevance! : "";
  const moduleFilter = searchParams.module ?? "";

  const [itemsRaw, agents, modules] = await Promise.all([
    prisma.finding.findMany({
      where: {
        status,
        ...(agentFilter ? (agentFilter === "none" ? { agentId: null } : { agentId: agentFilter }) : {}),
        ...(relevance ? { relevance } : {}),
        ...(moduleFilter ? { modules: { some: { moduleId: moduleFilter } } } : {}),
      },
      include: {
        modules: { include: { module: { select: { name: true } } } },
        agent: { select: { name: true } },
        knowledgeSource: { select: { kind: true } },
      },
      take: 200,
    }),
    prisma.agent.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.module.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Who each item affects: clients holding any of its modules. Inline Approve
  // links it to them as intel only — opportunities and tasks are chosen on the
  // item page, never created from a row.
  const tagged = Array.from(new Set(itemsRaw.flatMap((f) => f.modules.map((m) => m.moduleId))));
  const holdings = tagged.length
    ? await prisma.clientModule.findMany({ where: { moduleId: { in: tagged } }, select: { clientId: true, moduleId: true } })
    : [];
  const affectedIds = (f: (typeof itemsRaw)[number]) => {
    const mods = new Set(f.modules.map((m) => m.moduleId));
    return Array.from(new Set(holdings.filter((h) => mods.has(h.moduleId)).map((h) => h.clientId)));
  };

  const items = [...itemsRaw].sort((a, b) => {
    const r = (RELEVANCE_RANK[a.relevance] ?? 1) - (RELEVANCE_RANK[b.relevance] ?? 1);
    return r !== 0 ? r : b.createdAt.getTime() - a.createdAt.getTime();
  });

  const sourceChip = (f: (typeof items)[number]) =>
    f.knowledgeSource?.kind === "portal_video" || f.knowledgeSource?.kind === "youtube"
      ? "Webinar"
      : f.knowledgeSource?.kind === "page"
        ? "Community page"
        : f.sourceBody || f.agent?.name || "Added by hand";

  return (
    <div className="space-y-5">
      <PageHeader title="Inbox" />

      {!hasApiKey() && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          AI is off: add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart.
        </p>
      )}

      {/* Filters: one compact row. */}
      <form className="flex flex-wrap items-center gap-2 text-sm">
        <select name="status" defaultValue={status} className="field w-auto py-1.5">
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select name="relevance" defaultValue={relevance} className="field w-auto py-1.5">
          <option value="">Any relevance</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select name="module" defaultValue={moduleFilter} className="field w-auto py-1.5">
          <option value="">Any module</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select name="agent" defaultValue={agentFilter} className="field w-auto py-1.5">
          <option value="">Any source</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value="none">Added by hand</option>
        </select>
        <button type="submit" className="btn-ghost py-1.5">
          Filter
        </button>
        {(agentFilter || relevance || moduleFilter || status !== "pending") && (
          <Link href="/research" className="text-xs text-slate-500 hover:underline">
            Clear
          </Link>
        )}
      </form>

      {items.length === 0 ? (
        <EmptyState
          action={
            status === "pending" ? (
              <Link href="/agents" className="btn-ghost">
                Run an agent
              </Link>
            ) : undefined
          }
        >
          {status === "pending" ? "Nothing to review." : "Nothing here."}
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-slate-100 p-0">
          {items.map((f) => {
            const checked = isVerifiedCurrent(f);
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
                <Link href={`/research/${f.id}`} className="min-w-0 flex-1 basis-72">
                  <span className="block truncate text-sm font-semibold text-slate-900 hover:text-indigo-700">
                    {f.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className={`chip ${RELEVANCE_STYLES[f.relevance]}`}>{RELEVANCE_LABELS[f.relevance]}</span>
                    <StatusChip>{sourceChip(f)}</StatusChip>
                    {f.modules.slice(0, 3).map((fm) => (
                      <StatusChip key={fm.moduleId} tone="blue">
                        {fm.module.name}
                      </StatusChip>
                    ))}
                    {f.effectiveDate && <StatusChip tone="amber">Due {formatDate(f.effectiveDate)}</StatusChip>}
                    {status === "pending" && (
                      <StatusChip tone={checked ? "green" : "grey"}>{checked ? "Checked" : "Not checked"}</StatusChip>
                    )}
                  </span>
                </Link>
                {status === "pending" && (
                  <div className="flex items-center gap-2">
                    {checked ? (
                      <form action={finalizeApprove}>
                        <input type="hidden" name="id" value={f.id} />
                        {affectedIds(f).map((cid) => (
                          <span key={cid}>
                            <input type="hidden" name="clientIds" value={cid} />
                            <input type="hidden" name={`type_${cid}`} value="brief" />
                          </span>
                        ))}
                        <SubmitButton className="btn py-1.5" pendingLabel="Approving…">
                          Approve
                        </SubmitButton>
                      </form>
                    ) : (
                      <Link href={`/research/${f.id}`} className="btn py-1.5">
                        Review
                      </Link>
                    )}
                    <form action={dismissFinding}>
                      <input type="hidden" name="id" value={f.id} />
                      <button type="submit" className="btn-ghost py-1.5">
                        Dismiss
                      </button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Advanced label="Add an item by hand">
        <form action={ingestPaste} className="space-y-2">
          <input name="title" placeholder="Title" className="field" required />
          <textarea name="content" rows={3} placeholder="Paste the text" className="field" />
          <input name="sourceUrl" type="url" placeholder="Source link (optional)" className="field" />
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Adding…">Add to the inbox</SubmitButton>
          </div>
        </form>
      </Advanced>
    </div>
  );
}
