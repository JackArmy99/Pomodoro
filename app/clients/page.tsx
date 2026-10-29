import Link from "next/link";
import { prisma } from "@/lib/db";
import ClientForm from "@/components/forms/ClientForm";
import { PageHeader, StatusChip, EmptyState, Advanced } from "@/components/ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Clients" },
  { key: "prospect", label: "Prospects" },
];

export default async function ClientsPage({ searchParams }: { searchParams: { type?: string } }) {
  const typeFilter = searchParams.type ?? "";

  const clients = await prisma.client.findMany({
    where: typeFilter ? { type: typeFilter } : undefined,
    orderBy: { name: "asc" },
    include: {
      modules: { include: { module: { select: { name: true } } } },
      _count: { select: { briefs: true, opportunities: true } },
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Clients" />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/clients?type=${f.key}` : "/clients"}
            className={`chip ${
              typeFilter === f.key
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {clients.length === 0 ? (
        <EmptyState>No clients yet — add one below.</EmptyState>
      ) : (
        <ul className="card divide-y divide-slate-100 p-0">
          {clients.map((c) => {
            const mods = [...c.modules].sort((a, b) => a.module.name.localeCompare(b.module.name));
            const updates = c._count.briefs + c._count.opportunities;
            return (
              <li key={c.id}>
                <Link href={`/clients/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-slate-50">
                  <span className="flex w-40 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="truncate text-sm font-semibold text-slate-900">{c.name}</span>
                  </span>
                  <span className="w-20 text-xs text-slate-500">{c.type === "prospect" ? "Prospect" : "Client"}</span>
                  <span className="w-28 text-xs text-slate-500">{c.hosting ?? "—"}</span>
                  <span className={`w-28 text-xs ${c.tagetikRelease ? "text-slate-600" : "text-amber-700"}`}>
                    Release {c.tagetikRelease ?? "unknown"}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {mods.slice(0, 5).map((cm) => (
                      <StatusChip key={cm.moduleId} tone={cm.status === "in_use" ? "green" : "amber"}>
                        {cm.module.name}
                      </StatusChip>
                    ))}
                    {mods.length > 5 && <span className="text-xs text-slate-400">+{mods.length - 5}</span>}
                  </span>
                  {updates > 0 && <span className="text-xs text-indigo-600">{updates} updates</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Advanced label="Add a client">
        <ClientForm />
      </Advanced>
    </div>
  );
}
