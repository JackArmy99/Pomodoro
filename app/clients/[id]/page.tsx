import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { deleteClient } from "@/app/actions/clients";
import { deletePerson } from "@/app/actions/people";
import BriefCard from "@/components/BriefCard";
import OpportunityCard from "@/components/OpportunityCard";
import TaskItem from "@/components/TaskItem";
import BriefForm from "@/components/forms/BriefForm";
import OpportunityForm from "@/components/forms/OpportunityForm";
import TaskForm from "@/components/forms/TaskForm";
import PersonForm from "@/components/forms/PersonForm";
import ClientModules from "@/components/ClientModules";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      modules: { include: { module: true } },
      people: { orderBy: { createdAt: "asc" } },
      briefs: {
        include: { brief: { include: { clients: { include: { client: true } } } } },
      },
      opportunities: {
        include: { client: true, originBrief: true },
        orderBy: { createdAt: "desc" },
      },
      tasks: {
        where: { done: false },
        include: { client: true },
        orderBy: { dueDate: "asc" },
      },
    },
  });

  if (!client) notFound();

  const [allClients, clientBriefs, allModules] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.brief.findMany({
      where: { clients: { some: { clientId: client.id } } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
    prisma.module.findMany({ orderBy: { name: "asc" } }),
  ]);

  const currentModules: Record<string, string> = {};
  for (const cm of client.modules) currentModules[cm.moduleId] = cm.status;

  const briefs = client.briefs
    .map((bc) => bc.brief)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <div className="space-y-6">
      <div>
        <Link href="/clients" className="text-xs text-indigo-600 hover:underline">
          ← All clients
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: client.color }}
            />
            <h1 className="text-lg font-semibold text-slate-900">
              {client.name}
            </h1>
            {client.type === "prospect" && (
              <span className="chip border-amber-200 bg-amber-50 text-amber-700">
                prospect
              </span>
            )}
          </div>
          {client.notes && (
            <p className="mt-1 max-w-2xl whitespace-pre-wrap text-sm text-slate-500">
              {client.notes}
            </p>
          )}
        </div>
        <form action={deleteClient}>
          <input type="hidden" name="id" value={client.id} />
          <button
            type="submit"
            className="text-xs text-slate-400 hover:text-rose-600"
          >
            Delete client
          </button>
        </form>
      </header>

      <ClientModules
        clientId={client.id}
        hosting={client.hosting}
        modules={allModules}
        current={currentModules}
      />

      {/* People — identified by initials only. */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          People ({client.people.length})
        </h2>
        {client.people.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {client.people.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm"
              >
                <span className="font-medium text-slate-800">{p.initials}</span>
                {p.role && (
                  <span className="text-xs text-slate-500">{p.role}</span>
                )}
                <form action={deletePerson}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="clientId" value={client.id} />
                  <button
                    type="submit"
                    className="text-slate-400 hover:text-rose-600"
                    aria-label="Remove person"
                  >
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <PersonForm clientId={client.id} />
      </section>

      {/* This client's open tasks. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Open tasks ({client.tasks.length})
        </h2>
        {client.tasks.length === 0 ? (
          <p className="card text-sm text-slate-500">
            No open tasks for this client.
          </p>
        ) : (
          client.tasks.map((t) => <TaskItem key={t.id} task={t} />)
        )}
        <div className="pt-1">
          <TaskForm clients={allClients} presetClientId={client.id} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Briefs ({briefs.length})
          </h2>
          {briefs.length === 0 ? (
            <p className="card text-sm text-slate-500">
              No briefs tagged to this client yet.
            </p>
          ) : (
            briefs.map((b) => (
              <BriefCard key={b.id} brief={b} showClients={false} />
            ))
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Opportunities ({client.opportunities.length})
          </h2>
          {client.opportunities.length === 0 ? (
            <p className="card text-sm text-slate-500">
              No opportunities for this client yet.
            </p>
          ) : (
            client.opportunities.map((o) => (
              <OpportunityCard key={o.id} opportunity={o} />
            ))
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <BriefForm clients={allClients} presetClientId={client.id} />
        <OpportunityForm
          clients={allClients}
          briefs={clientBriefs}
          presetClientId={client.id}
        />
      </div>
    </div>
  );
}
