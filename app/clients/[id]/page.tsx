import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { deleteClient } from "@/app/actions/clients";
import { deletePerson } from "@/app/actions/people";
import { setClientHosting, setClientRelease } from "@/app/actions/modules";
import OpportunityCard from "@/components/OpportunityCard";
import TaskItem from "@/components/TaskItem";
import BriefForm from "@/components/forms/BriefForm";
import OpportunityForm from "@/components/forms/OpportunityForm";
import TaskForm from "@/components/forms/TaskForm";
import PersonForm from "@/components/forms/PersonForm";
import ClientModules from "@/components/ClientModules";
import SubmitButton from "@/components/SubmitButton";
import { HOSTING_OPTIONS, MODULE_STATUS_LABELS, formatDate } from "@/lib/format";
import { RELEASE_SUGGESTIONS } from "@/lib/knowledge/authority";
import { PageHeader, Section, StatusChip, EmptyState, Advanced } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      modules: { include: { module: true } },
      people: { orderBy: { createdAt: "asc" } },
      briefs: { include: { brief: { include: { modules: { include: { module: true } } } } } },
      opportunities: {
        include: { client: true, originBrief: true, category: true },
        orderBy: { createdAt: "desc" },
      },
      tasks: { where: { done: false }, include: { client: true }, orderBy: { dueDate: "asc" } },
    },
  });
  if (!client) notFound();

  const [allClients, allModules, categories] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.module.findMany({ orderBy: { name: "asc" } }),
    prisma.opportunityCategory.findMany({ orderBy: { name: "asc" } }),
  ]);

  const current: Record<string, string> = {};
  for (const cm of client.modules) current[cm.moduleId] = cm.status;
  const held = [...client.modules].sort((a, b) => a.module.name.localeCompare(b.module.name));

  const intel = client.briefs.map((bc) => bc.brief).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const updates = intel.length + client.opportunities.length + client.tasks.length;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/clients", label: "Clients" }}
        title={
          <span className="flex items-center gap-2">
            <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: client.color }} />
            {client.name}
          </span>
        }
        chips={
          <>
            <StatusChip tone={client.type === "prospect" ? "amber" : "grey"}>
              {client.type === "prospect" ? "Prospect" : "Client"}
            </StatusChip>
            {client.hosting && <StatusChip>{client.hosting}</StatusChip>}
            <StatusChip tone={client.tagetikRelease ? "grey" : "amber"}>
              Release {client.tagetikRelease ?? "unknown"}
            </StatusChip>
          </>
        }
      />
      {client.notes && <p className="max-w-2xl whitespace-pre-wrap text-sm text-slate-600">{client.notes}</p>}

      <Section title="Modules">
        <div className="card space-y-3">
          {held.length === 0 ? (
            <p className="text-sm text-slate-500">No modules recorded.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {held.map((cm) => (
                <StatusChip key={cm.moduleId} tone={cm.status === "in_use" ? "green" : "amber"}>
                  {cm.module.name} · {MODULE_STATUS_LABELS[cm.status]}
                </StatusChip>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <form action={setClientHosting} className="flex items-center gap-2">
              <input type="hidden" name="clientId" value={client.id} />
              <label className="text-xs text-slate-500" htmlFor="hosting">
                Hosting
              </label>
              <select id="hosting" name="hosting" defaultValue={client.hosting ?? ""} className="field w-40 py-1">
                <option value="">—</option>
                {HOSTING_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn-ghost py-1" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </form>
            <form action={setClientRelease} className="flex items-center gap-2">
              <input type="hidden" name="clientId" value={client.id} />
              <label className="text-xs text-slate-500" htmlFor="tagetikRelease">
                Tagetik release
              </label>
              <input
                id="tagetikRelease"
                name="tagetikRelease"
                defaultValue={client.tagetikRelease ?? ""}
                placeholder="unknown"
                list="release-suggestions"
                className="field w-32 py-1"
              />
              <datalist id="release-suggestions">
                {RELEASE_SUGGESTIONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              <SubmitButton className="btn-ghost py-1" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </form>
          </div>
        </div>
        <Advanced label="Change modules">
          <ClientModules clientId={client.id} clientName={client.name} modules={allModules} current={current} />
        </Advanced>
      </Section>

      <Section title={`Updates for this client${updates ? ` (${updates})` : ""}`}>
        {updates === 0 ? (
          <EmptyState
            action={
              <Link href="/research" className="btn-ghost">
                Open the inbox
              </Link>
            }
          >
            Nothing yet — approved inbox items for {client.name} appear here.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {intel.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Intel ({intel.length})</h3>
                <ul className="card divide-y divide-slate-100 p-0">
                  {intel.map((b) => (
                    <li key={b.id}>
                      <Link href={`/briefs/${b.id}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 hover:bg-slate-50">
                        <span className="min-w-0 flex-1 truncate text-sm text-slate-900">{b.title}</span>
                        {b.modules.slice(0, 3).map((bm) => (
                          <StatusChip key={bm.moduleId} tone="blue">
                            {bm.module.name}
                          </StatusChip>
                        ))}
                        <span className="text-xs text-slate-400">{formatDate(b.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {client.opportunities.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Opportunities ({client.opportunities.length})
                </h3>
                <div className="grid gap-2 lg:grid-cols-2">
                  {client.opportunities.map((o) => (
                    <OpportunityCard key={o.id} opportunity={o} />
                  ))}
                </div>
              </div>
            )}
            {client.tasks.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tasks ({client.tasks.length})</h3>
                {client.tasks.map((t) => (
                  <TaskItem key={t.id} task={t} />
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title={`People (${client.people.length})`}>
        <div className="card space-y-3">
          {client.people.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {client.people.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm"
                >
                  <span className="font-medium text-slate-800">{p.initials}</span>
                  {p.role && <span className="text-xs text-slate-500">{p.role}</span>}
                  <form action={deletePerson}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="clientId" value={client.id} />
                    <button type="submit" className="text-slate-400 hover:text-rose-600" aria-label={`Remove ${p.initials}`}>
                      ✕
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <PersonForm clientId={client.id} />
        </div>
      </Section>

      <Advanced label="Add by hand">
        <TaskForm clients={allClients} presetClientId={client.id} />
        <div className="grid gap-4 lg:grid-cols-2">
          <BriefForm clients={allClients} modules={allModules} presetClientId={client.id} />
          <OpportunityForm
            clients={allClients}
            briefs={intel.map((b) => ({ id: b.id, title: b.title }))}
            categories={categories}
            presetClientId={client.id}
          />
        </div>
        <form action={deleteClient} className="border-t border-slate-100 pt-3 text-right">
          <input type="hidden" name="id" value={client.id} />
          <button type="submit" className="text-xs text-rose-600 hover:underline">
            Delete this client
          </button>
        </form>
      </Advanced>
    </div>
  );
}
