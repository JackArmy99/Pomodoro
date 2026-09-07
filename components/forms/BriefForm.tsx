import { createBrief } from "@/app/actions/briefs";
import { SOURCE_TYPES, SOURCE_LABELS } from "@/lib/format";

type ClientOption = { id: string; name: string };
type ModuleOption = { id: string; name: string };

export default function BriefForm({
  clients,
  modules = [],
  presetClientId,
}: {
  clients: ClientOption[];
  modules?: ModuleOption[];
  presetClientId?: string;
}) {
  return (
    <form action={createBrief} className="card space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">Add a brief</h2>

      <div>
        <label className="label" htmlFor="brief-title">
          Title
        </label>
        <input
          id="brief-title"
          name="title"
          required
          placeholder="e.g. CCH Tagetik 2026.1 adds AI-assisted reconciliation"
          className="field"
        />
      </div>

      <div>
        <label className="label" htmlFor="brief-summary">
          Summary
        </label>
        <textarea
          id="brief-summary"
          name="summary"
          rows={3}
          placeholder="What changed and why it matters to clients…"
          className="field"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="brief-sourceType">
            Source type
          </label>
          <select id="brief-sourceType" name="sourceType" className="field">
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SOURCE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="brief-sourceUrl">
            Source URL
          </label>
          <input
            id="brief-sourceUrl"
            name="sourceUrl"
            type="url"
            placeholder="https://…"
            className="field"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="brief-publishedAt">
            Published date
          </label>
          <input
            id="brief-publishedAt"
            name="publishedAt"
            type="date"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="brief-clients">
            Relevant clients{" "}
            <span className="font-normal text-slate-400">
              (Ctrl/Cmd-click for several)
            </span>
          </label>
          <select
            id="brief-clients"
            name="clientIds"
            multiple
            size={Math.min(Math.max(clients.length, 2), 5)}
            className="field"
            defaultValue={presetClientId ? [presetClientId] : []}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {modules.length > 0 && (
        <div>
          <label className="label" htmlFor="brief-modules">
            Modules this is about{" "}
            <span className="font-normal text-slate-400">
              (drives “who’s affected”; Ctrl/Cmd-click for several)
            </span>
          </label>
          <select
            id="brief-modules"
            name="moduleIds"
            multiple
            size={Math.min(Math.max(modules.length, 2), 5)}
            className="field"
          >
            {modules.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" className="btn">
          Add brief
        </button>
      </div>
    </form>
  );
}
