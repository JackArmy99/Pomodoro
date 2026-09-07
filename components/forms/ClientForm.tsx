import { createClient } from "@/app/actions/clients";

export default function ClientForm() {
  return (
    <form action={createClient} className="card space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">Add a client</h2>

      <div>
        <label className="label" htmlFor="client-name">
          Name
        </label>
        <input
          id="client-name"
          name="name"
          required
          placeholder="e.g. Acme Manufacturing"
          className="field"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="client-type">
            Type
          </label>
          <select id="client-type" name="type" className="field">
            <option value="active">Active client</option>
            <option value="prospect">Prospect</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="client-color">
            Colour
          </label>
          <input
            id="client-color"
            name="color"
            type="color"
            defaultValue="#6366f1"
            className="field h-[38px] p-1"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="client-notes">
          Notes
        </label>
        <textarea
          id="client-notes"
          name="notes"
          rows={2}
          placeholder="Key contact, systems in use, context…"
          className="field"
        />
      </div>

      <div className="flex justify-end">
        <button type="submit" className="btn">
          Add client
        </button>
      </div>
    </form>
  );
}
