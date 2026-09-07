import Link from "next/link";
import { prisma } from "@/lib/db";
import ClientForm from "@/components/forms/ClientForm";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const typeFilter = searchParams.type;

  const clients = await prisma.client.findMany({
    where: typeFilter ? { type: typeFilter } : undefined,
    orderBy: { name: "asc" },
    include: {
      _count: { select: { briefs: true, opportunities: true } },
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">
          Clients &amp; prospects
        </h1>
        <p className="text-sm text-slate-500">
          The directory everything hangs off. Open a client to see their briefs
          and opportunities.
        </p>
      </header>

      <ClientForm />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500">View:</span>
        <FilterChip href="/clients" active={!typeFilter}>
          All
        </FilterChip>
        <FilterChip href="/clients?type=active" active={typeFilter === "active"}>
          Active
        </FilterChip>
        <FilterChip
          href="/clients?type=prospect"
          active={typeFilter === "prospect"}
        >
          Prospects
        </FilterChip>
      </div>

      {clients.length === 0 ? (
        <p className="card text-sm text-slate-500">
          No clients yet. Add one above.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="card block hover:border-indigo-300"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: c.color }}
                  />
                  <span className="font-medium text-slate-900">{c.name}</span>
                  {c.type === "prospect" && (
                    <span className="chip border-amber-200 bg-amber-50 text-amber-700">
                      prospect
                    </span>
                  )}
                </div>
                {c.notes && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-slate-500">
                    {c.notes}
                  </p>
                )}
                <div className="mt-3 flex gap-3 text-xs text-slate-400">
                  <span>{c._count.briefs} briefs</span>
                  <span>{c._count.opportunities} opportunities</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`chip ${
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );
}
