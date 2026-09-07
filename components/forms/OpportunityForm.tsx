import { createOpportunity } from "@/app/actions/opportunities";
import { STAGES, STAGE_LABELS } from "@/lib/format";

type ClientOption = { id: string; name: string };
type BriefOption = { id: string; title: string };

export default function OpportunityForm({
  clients,
  briefs = [],
  presetClientId,
  presetBriefId,
}: {
  clients: ClientOption[];
  briefs?: BriefOption[];
  presetClientId?: string;
  presetBriefId?: string;
}) {
  return (
    <form action={createOpportunity} className="card space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">Add an opportunity</h2>

      <div>
        <label className="label" htmlFor="opp-title">
          Title
        </label>
        <input
          id="opp-title"
          name="title"
          required
          placeholder="e.g. Pitch ESG module to Acme following CSRD update"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="opp-description">
          Description
        </label>
        <textarea
          id="opp-description"
          name="description"
          rows={2}
          placeholder="The opening and the angle…"
          className="field"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="opp-client">
            Client
          </label>
          <select
            id="opp-client"
            name="clientId"
            className="field"
            defaultValue={presetClientId ?? ""}
          >
            <option value="">— none —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="opp-stage">
            Stage
          </label>
          <select id="opp-stage" name="stage" className="field">
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="opp-value">
            Value (€)
          </label>
          <input
            id="opp-value"
            name="value"
            type="number"
            min="0"
            placeholder="25000"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="opp-likelihood">
            Likelihood (%)
          </label>
          <input
            id="opp-likelihood"
            name="likelihood"
            type="number"
            min="0"
            max="100"
            placeholder="40"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="opp-deadline">
            Deadline
          </label>
          <input
            id="opp-deadline"
            name="deadline"
            type="date"
            className="field"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="opp-nextStep">
          Next step
        </label>
        <input
          id="opp-nextStep"
          name="nextStep"
          placeholder="e.g. Email account owner to arrange a demo"
          className="field"
        />
      </div>

      {briefs.length > 0 && (
        <div>
          <label className="label" htmlFor="opp-brief">
            Sparked by brief{" "}
            <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <select
            id="opp-brief"
            name="originBriefId"
            className="field"
            defaultValue={presetBriefId ?? ""}
          >
            <option value="">— none —</option>
            {briefs.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn">
          Add opportunity
        </button>
      </div>
    </form>
  );
}
