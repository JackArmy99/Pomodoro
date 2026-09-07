import { createPerson } from "@/app/actions/people";

export default function PersonForm({ clientId }: { clientId: string }) {
  return (
    <form action={createPerson} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <div>
        <label className="label" htmlFor="person-initials">
          Initials
        </label>
        <input
          id="person-initials"
          name="initials"
          required
          placeholder="J.A."
          className="field w-24"
        />
      </div>
      <div className="flex-1">
        <label className="label" htmlFor="person-role">
          Role (optional)
        </label>
        <input
          id="person-role"
          name="role"
          placeholder="FP&A lead"
          className="field"
        />
      </div>
      <button type="submit" className="btn-ghost">
        Add person
      </button>
    </form>
  );
}
