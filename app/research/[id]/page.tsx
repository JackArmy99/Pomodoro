import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  updateFinding,
  digDeeper,
  dismissFinding,
  finalizeApprove,
  summariseFinding,
  setFindingVerified,
} from "@/app/actions/research";
import SubmitButton from "@/components/SubmitButton";
import { isVerifiedCurrent } from "@/lib/research/revision";
import {
  formatDate,
  RELEVANCE_STYLES,
  RELEVANCE_LABELS,
  MODULE_STATUS_LABELS,
} from "@/lib/format";
import { PageHeader, StatusChip, Advanced } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FindingDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const finding = await prisma.finding.findUnique({
    where: { id: params.id },
    include: {
      modules: { include: { module: true } },
      agent: { select: { name: true } },
    },
  });
  if (!finding) notFound();

  // Verified only counts for the revision actually reviewed.
  const checkedNow = isVerifiedCurrent(finding);

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

  const done = finding.status !== "pending";

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: "/research", label: "Inbox" }}
        title={finding.title}
        chips={
          <>
            <span className={`chip ${RELEVANCE_STYLES[finding.relevance]}`}>{RELEVANCE_LABELS[finding.relevance]}</span>
            <StatusChip>{finding.agent ? finding.agent.name : "Added by hand"}</StatusChip>
            {finding.sourceBody && <StatusChip tone="blue">{finding.sourceBody}</StatusChip>}
            {finding.effectiveDate && <StatusChip tone="amber">Due {formatDate(finding.effectiveDate)}</StatusChip>}
            {done && (
              <StatusChip tone={finding.status === "approved" ? "green" : "grey"}>
                {finding.status === "approved" ? "Approved" : "Dismissed"}
              </StatusChip>
            )}
            <span className="text-xs text-slate-400">{formatDate(finding.publishedAt ?? finding.createdAt)}</span>
          </>
        }
        action={
          !done ? (
            <form action={dismissFinding}>
              <input type="hidden" name="id" value={finding.id} />
              <button type="submit" className="btn-ghost">
                Dismiss
              </button>
            </form>
          ) : null
        }
      />

      {/* 1. What it says, and where it came from. */}
      <section className="card space-y-2">
        {finding.summary ? (
          <p className="whitespace-pre-wrap text-sm text-slate-800">{finding.summary}</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-slate-600">{finding.rawContent.slice(0, 1200)}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {finding.modules.map((fm) => (
            <StatusChip key={fm.moduleId} tone="blue">
              {fm.module.name}
            </StatusChip>
          ))}
          {finding.sourceUrl && (
            <a
              href={finding.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-sm font-medium text-indigo-600 hover:underline"
            >
              Open the source ↗
            </a>
          )}
          {finding.knowledgeSourceId && (
            <Link href={`/library/${finding.knowledgeSourceId}`} className="text-sm font-medium text-indigo-600 hover:underline">
              In the Library →
            </Link>
          )}
        </div>
        {!finding.aiProcessed && (
          <form action={summariseFinding}>
            <input type="hidden" name="id" value={finding.id} />
            <SubmitButton className="btn-ghost py-1.5" pendingLabel="Summarising…">
              Summarise
            </SubmitButton>
          </form>
        )}
      </section>

      {!done && (
        <>
          {/* 2. Check the source. */}
          <form action={setFindingVerified} className="card flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="id" value={finding.id} />
            <input type="hidden" name="verified" value={checkedNow ? "false" : "true"} />
            <span className="flex items-center gap-2 text-sm">
              <StatusChip tone={checkedNow ? "green" : "grey"}>{checkedNow ? "Source checked" : "Source not checked"}</StatusChip>
              {!checkedNow && <span className="text-slate-500">Needed before approving.</span>}
            </span>
            <button type="submit" className={checkedNow ? "btn-ghost" : "btn"}>
              {checkedNow ? "Undo" : "Mark source checked"}
            </button>
          </form>

          {/* 3. Who it goes to, then Approve. */}
          <form action={finalizeApprove} className="card space-y-3">
            <input type="hidden" name="id" value={finding.id} />
            <h2 className="text-sm font-semibold text-slate-900">Affects</h2>
            {searchParams.error === "verify" && (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">Mark the source checked first.</p>
            )}
            {moduleIds.length === 0 ? (
              <p className="text-sm text-amber-700">No modules tagged — add them under Edit to see who it affects.</p>
            ) : affected.length === 0 ? (
              <p className="text-sm text-slate-500">No clients hold these modules.</p>
            ) : (
              <ul className="space-y-1.5">
                {affected.map(({ client, matches }) => (
                  <li key={client.id} className="flex flex-wrap items-center gap-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <input type="checkbox" name="clientIds" value={client.id} defaultChecked className="h-4 w-4" />
                      <span className="font-medium text-slate-800">{client.name}</span>
                      <span className="truncate text-xs text-slate-400">{matches.join(", ")}</span>
                    </label>
                    <select name={`type_${client.id}`} defaultValue="brief" className="field w-44 py-1">
                      <option value="brief">Intel only</option>
                      <option value="opportunity">+ Opportunity</option>
                      <option value="task">+ Task</option>
                    </select>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                className="btn"
                disabled={!checkedNow}
                title={checkedNow ? undefined : "Mark the source checked first"}
              >
                Approve
              </button>
            </div>
          </form>

          {/* Editing, and asking for more, only when needed. */}
          <Advanced label="Edit">
            <form action={updateFinding} className="space-y-3">
              <input type="hidden" name="id" value={finding.id} />
              <label className="label">
                Summary
                <textarea name="summary" rows={6} defaultValue={finding.summary} className="field mt-1" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="label">
                  Relevance
                  <select name="relevance" defaultValue={finding.relevance} className="field mt-1">
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="label">
                  Modules (Ctrl-click for several)
                  <select
                    name="moduleIds"
                    multiple
                    size={Math.min(Math.max(allModules.length, 3), 6)}
                    defaultValue={allModules.filter((m) => currentModuleIds.has(m.id)).map((m) => m.id)}
                    className="field mt-1"
                  >
                    {allModules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex justify-end">
                <SubmitButton className="btn-ghost" pendingLabel="Saving…">
                  Save
                </SubmitButton>
              </div>
            </form>
            <form action={digDeeper} className="flex items-end gap-2 border-t border-slate-100 pt-3">
              <input type="hidden" name="id" value={finding.id} />
              <input name="note" placeholder="Research more — e.g. pricing and rollout dates" className="field" />
              <SubmitButton className="btn-ghost whitespace-nowrap" pendingLabel="Researching…">
                Research more
              </SubmitButton>
            </form>
          </Advanced>
        </>
      )}
    </div>
  );
}
