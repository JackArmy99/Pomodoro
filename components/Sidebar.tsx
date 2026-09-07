import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/db";

const mainLinks = [
  { href: "/", label: "Hub", hint: "My tasks" },
  { href: "/briefs", label: "Briefs" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/clients", label: "All clients" },
];

export default async function Sidebar() {
  noStore(); // always show the current client list, including newly added ones
  const clients = await prisma.client.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: { id: true, name: true, type: true, color: true },
  });

  const active = clients.filter((c) => c.type === "active");
  const prospects = clients.filter((c) => c.type === "prospect");

  return (
    <aside className="flex h-full w-full flex-col gap-6 border-r border-slate-200 bg-white p-4">
      <Link href="/" className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">
          B
        </span>
        <span className="text-sm font-semibold tracking-tight">
          Beacon
          <span className="ml-1.5 font-normal text-slate-400">Intel Hub</span>
        </span>
      </Link>

      <nav className="flex flex-col gap-0.5 text-sm">
        {mainLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="flex items-center justify-between rounded-md px-3 py-2 text-slate-700 transition hover:bg-slate-100"
          >
            <span>{l.label}</span>
            {l.hint && (
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                {l.hint}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ClientGroup label="Clients" clients={active} />
        {prospects.length > 0 && (
          <ClientGroup label="Prospects" clients={prospects} />
        )}
        <Link
          href="/clients"
          className="mt-2 block rounded-md px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
        >
          + Add client
        </Link>
      </div>
    </aside>
  );
}

function ClientGroup({
  label,
  clients,
}: {
  label: string;
  clients: { id: string; name: string; type: string; color: string }[];
}) {
  return (
    <div className="mb-3">
      <h3 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </h3>
      {clients.length === 0 ? (
        <p className="px-3 text-xs text-slate-400">None yet</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {clients.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="truncate">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
