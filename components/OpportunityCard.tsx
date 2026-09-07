import {
  deleteOpportunity,
  setOpportunityStage,
} from "@/app/actions/opportunities";
import {
  formatDate,
  formatMoney,
  STAGES,
  STAGE_LABELS,
  STAGE_STYLES,
} from "@/lib/format";
import ClientBadge from "@/components/ClientBadge";

type Opportunity = {
  id: string;
  title: string;
  description: string;
  stage: string;
  value: number | null;
  likelihood: number | null;
  nextStep: string | null;
  deadline: Date | null;
  client: { id: string; name: string; type: string; color: string } | null;
  originBrief: { id: string; title: string } | null;
  category?: { id: string; name: string } | null;
};

export default function OpportunityCard({
  opportunity: o,
}: {
  opportunity: Opportunity;
}) {
  const overdue =
    o.deadline != null &&
    o.stage !== "won" &&
    o.stage !== "lost" &&
    new Date(o.deadline) < new Date();

  return (
    <article className="card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{o.title}</h3>
        <div className="flex shrink-0 items-center gap-1">
          {o.category && (
            <span className="chip border-violet-200 bg-violet-50 text-violet-700">
              {o.category.name}
            </span>
          )}
          <span className={`chip ${STAGE_STYLES[o.stage] ?? ""}`}>
            {STAGE_LABELS[o.stage] ?? o.stage}
          </span>
        </div>
      </div>

      {o.description && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-600">
          {o.description}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
        {o.value != null && (
          <div>
            <dt className="inline text-slate-400">Value: </dt>
            <dd className="inline font-medium text-slate-700">
              {formatMoney(o.value)}
            </dd>
          </div>
        )}
        {o.likelihood != null && (
          <div>
            <dt className="inline text-slate-400">Likelihood: </dt>
            <dd className="inline font-medium text-slate-700">
              {o.likelihood}%
            </dd>
          </div>
        )}
        {o.deadline && (
          <div>
            <dt className="inline text-slate-400">Deadline: </dt>
            <dd
              className={`inline font-medium ${
                overdue ? "text-rose-600" : "text-slate-700"
              }`}
            >
              {formatDate(o.deadline)}
              {overdue && " (overdue)"}
            </dd>
          </div>
        )}
      </dl>

      {o.nextStep && (
        <p className="mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
          <span className="font-medium text-slate-500">Next: </span>
          {o.nextStep}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {o.client && <ClientBadge client={o.client} />}
        {o.originBrief && (
          <span className="text-[11px] text-slate-400">
            from brief: {o.originBrief.title}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-3">
        <span className="mr-1 text-[11px] text-slate-400">Move to:</span>
        {STAGES.filter((s) => s !== o.stage).map((s) => (
          <form key={s} action={setOpportunityStage}>
            <input type="hidden" name="id" value={o.id} />
            <input type="hidden" name="stage" value={s} />
            <button
              type="submit"
              className="rounded border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
            >
              {STAGE_LABELS[s]}
            </button>
          </form>
        ))}
        <form action={deleteOpportunity} className="ml-auto">
          <input type="hidden" name="id" value={o.id} />
          <button
            type="submit"
            className="text-[11px] text-slate-400 hover:text-rose-600"
          >
            Delete
          </button>
        </form>
      </div>
    </article>
  );
}
