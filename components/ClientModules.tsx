import {
  createModule,
  setClientHosting,
  setClientModule,
} from "@/app/actions/modules";
import { createOpportunityQuick } from "@/app/actions/opportunities";
import {
  HOSTING_OPTIONS,
  MODULE_STATUS_LABELS,
  MODULE_STATUS_STYLES,
} from "@/lib/format";

type ModuleRow = { id: string; name: string };

export default function ClientModules({
  clientId,
  clientName,
  hosting,
  modules,
  current, // moduleId -> status
}: {
  clientId: string;
  clientName: string;
  hosting: string | null;
  modules: ModuleRow[];
  current: Record<string, string>;
}) {
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Modules &amp; licences
        </h2>
        {/* Hosting selector */}
        <form action={setClientHosting} className="flex items-center gap-2">
          <input type="hidden" name="clientId" value={clientId} />
          <label className="text-xs text-slate-500" htmlFor="hosting">
            Hosting
          </label>
          <select
            id="hosting"
            name="hosting"
            defaultValue={hosting ?? ""}
            className="field w-40 py-1"
          >
            <option value="">—</option>
            {HOSTING_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-ghost py-1">
            Save
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-500">
        <span className="font-medium text-emerald-700">In use</span> = actively
        running · <span className="font-medium text-amber-700">Licensed</span> =
        owned but not in use (an upsell opening).
      </p>

      <ul className="divide-y divide-slate-100">
        {modules.map((m) => {
          const status = current[m.id]; // undefined | "in_use" | "licensed"
          return (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-800">{m.name}</span>
                {status && (
                  <span className={`chip ${MODULE_STATUS_STYLES[status]}`}>
                    {MODULE_STATUS_LABELS[status]}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {/* Upsell shortcut: licensed-but-unused → an opportunity. */}
                {status === "licensed" && (
                  <form action={createOpportunityQuick}>
                    <input type="hidden" name="clientId" value={clientId} />
                    <input
                      type="hidden"
                      name="title"
                      value={`Activate ${m.name} — ${clientName}`}
                    />
                    <input
                      type="hidden"
                      name="description"
                      value={`${clientName} is licensed for ${m.name} but not using it — activation opportunity.`}
                    />
                    <button
                      type="submit"
                      className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-100"
                      title="Create an opportunity to activate this licensed module"
                    >
                      → Opportunity
                    </button>
                  </form>
                )}
                <StatusButton
                  clientId={clientId}
                  moduleId={m.id}
                  status="in_use"
                  active={status === "in_use"}
                  label="In use"
                />
                <StatusButton
                  clientId={clientId}
                  moduleId={m.id}
                  status="licensed"
                  active={status === "licensed"}
                  label="Licensed"
                />
                {status && (
                  <StatusButton
                    clientId={clientId}
                    moduleId={m.id}
                    status="none"
                    active={false}
                    label="✕"
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Add a brand-new module to the catalogue */}
      <form action={createModule} className="flex items-end gap-2 border-t border-slate-100 pt-3">
        <input type="hidden" name="clientId" value={clientId} />
        <div className="flex-1">
          <label className="label" htmlFor="new-module">
            Add a module to the catalogue
          </label>
          <input
            id="new-module"
            name="name"
            placeholder="e.g. Disclosure Management"
            className="field"
          />
        </div>
        <button type="submit" className="btn-ghost">
          Add module
        </button>
      </form>
    </section>
  );
}

function StatusButton({
  clientId,
  moduleId,
  status,
  active,
  label,
}: {
  clientId: string;
  moduleId: string;
  status: string;
  active: boolean;
  label: string;
}) {
  return (
    <form action={setClientModule}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="moduleId" value={moduleId} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className={`rounded border px-2 py-0.5 text-[11px] transition ${
          active
            ? "border-indigo-600 bg-indigo-600 text-white"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        }`}
      >
        {label}
      </button>
    </form>
  );
}
