import { prisma } from "@/lib/db";
import OpportunityForm from "@/components/forms/OpportunityForm";
import OpportunityCard from "@/components/OpportunityCard";
import { STAGES, STAGE_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const [opportunities, clients, briefs] = await Promise.all([
    prisma.opportunity.findMany({
      include: { client: true, originBrief: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.brief.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Opportunities</h1>
        <p className="text-sm text-slate-500">
          Leads and openings with clients and prospects — your pipeline of
          future work.
        </p>
      </header>

      <OpportunityForm clients={clients} briefs={briefs} />

      <section className="grid gap-4 lg:grid-cols-4">
        {STAGES.map((stage) => {
          const inStage = opportunities.filter((o) => o.stage === stage);
          return (
            <div key={stage} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  {STAGE_LABELS[stage]}
                </h2>
                <span className="chip border-slate-200 bg-slate-100 text-slate-500">
                  {inStage.length}
                </span>
              </div>
              {inStage.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  Empty
                </p>
              ) : (
                inStage.map((o) => (
                  <OpportunityCard key={o.id} opportunity={o} />
                ))
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
