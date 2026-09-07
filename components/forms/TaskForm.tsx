import { createTask } from "@/app/actions/tasks";
import { URGENCIES, URGENCY_LABELS } from "@/lib/format";

type ClientOption = { id: string; name: string };

export default function TaskForm({
  clients,
  presetClientId,
}: {
  clients: ClientOption[];
  presetClientId?: string;
}) {
  return (
    <form action={createTask} className="card space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">Add a task</h2>

      <div>
        <label className="label" htmlFor="task-title">
          What needs doing?
        </label>
        <input
          id="task-title"
          name="title"
          required
          placeholder="e.g. Prep upgrade proposal for Falcon"
          className="field"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="task-urgency">
            Urgency
          </label>
          <select
            id="task-urgency"
            name="urgency"
            defaultValue="normal"
            className="field"
          >
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {URGENCY_LABELS[u]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="task-due">
            Due date
          </label>
          <input id="task-due" name="dueDate" type="date" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="task-estimate">
            Time (mins)
          </label>
          <input
            id="task-estimate"
            name="estimateMinutes"
            type="number"
            min="0"
            step="15"
            placeholder="30"
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="task-client">
            Client
          </label>
          <select
            id="task-client"
            name="clientId"
            defaultValue={presetClientId ?? ""}
            className="field"
          >
            <option value="">— none —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="btn">
          Add task
        </button>
      </div>
    </form>
  );
}
