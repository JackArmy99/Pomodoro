import { setClientModule } from "@/app/actions/modules";
import { createOpportunityQuick } from "@/app/actions/opportunities";
import { MODULE_STATUS_LABELS, MODULE_STATUS_STYLES } from "@/lib/format";

type ModuleRow = { id: string; name: string };

// Every module, with In use / Licensed / remove for this client. Licensed but
// not in use offers "→ Opportunity" (an activation upsell).
export default function ClientModules({
  clientId,
  clientName,
  modules,
  current, // moduleId -> status
}: {
  clientId: string;
  clientName: string;
  modules: ModuleRow[];
  current: Record<string, string>;
}) {
  return (
    <div>
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

    </div>
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
