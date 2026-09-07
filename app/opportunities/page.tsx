import { prisma } from "@/lib/db";
import OpportunityForm from "@/components/forms/OpportunityForm";
import OpportunityCard from "@/components/OpportunityCard";
import { createCategory, deleteCategory } from "@/app/actions/categories";
import { STAGES, STAGE_LABELS } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  const [opportunities, clients, briefs, categories] = await Promise.all([
    prisma.opportunity.findMany({
      include: { client: true, originBrief: true, category: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" } }),
    prisma.brief.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true },
      take: 50,
    }),
    prisma.opportunityCategory.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Opportunities</h1>
        <p className="text-sm text-slate-500">
          Your pipeline of prospect projects — mostly expansion work with current
          clients.
        </p>
      </header>

      <OpportunityForm clients={clients} briefs={briefs} categories={categories} />

      {/* Your own opportunity categories. */}
      <section className="card space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Categories</h2>
        <p className="text-xs text-slate-500">
          Define the categories that suit your work (e.g. how you split types of
          project). They appear in the opportunity form.
        </p>
        {categories.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm text-violet-800"
              >
                {c.name}
                <form action={deleteCategory}>
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    className="text-violet-400 hover:text-rose-600"
                    aria-label="Remove category"
                  >
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={createCategory} className="flex items-end gap-2">
          <div className="flex-1">
            <label className="label" htmlFor="new-category">
              Add a category
            </label>
            <input
              id="new-category"
              name="name"
              placeholder="e.g. Module activation"
              className="field"
            />
          </div>
          <button type="submit" className="btn-ghost">
            Add
          </button>
        </form>
      </section>

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
