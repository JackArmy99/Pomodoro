import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { deleteClient } from "@/app/actions/clients";
import BriefCard from "@/components/BriefCard";
import OpportunityCard from "@/components/OpportunityCard";
import BriefForm from "@/components/forms/BriefForm";
import OpportunityForm from "@/components/forms/OpportunityForm";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      briefs: {
        include: { brief: { include: { clients: { include: { client: true } } } } },
      },
      opportunities: {
        include: { client: true, originBrief: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!client) notFound();

  const [allClients, clientBriefs] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.brief.findMany({
      where: { clients: { some: { clientId: client.id } } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
    }),
  ]);

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
