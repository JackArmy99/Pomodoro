import Link from "next/link";
import { prisma } from "@/lib/db";
import BriefForm from "@/components/forms/BriefForm";
import BriefCard from "@/components/BriefCard";
import { SOURCE_TYPES, SOURCE_LABELS } from "@/lib/format";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function BriefsPage({
  searchParams,
}: {
  searchParams: { client?: string; type?: string };
}) {
  const { client: clientFilter, type: typeFilter } = searchParams;

  const where: Prisma.BriefWhereInput = {};
  if (typeFilter) where.sourceType = typeFilter;
  if (clientFilter) where.clients = { some: { clientId: clientFilter } };

  const [briefs, clients] = await Promise.all([
    prisma.brief.findMany({
      where,
      include: { clients: { include: { client: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" } }),
  ]);

  const activeClientName = clientFilter
    ? clients.find((c) => c.id === clientFilter)?.name
    : undefined;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Briefs</h1>
        <p className="text-sm text-slate-500">
          Vendor updates, newsletter items and video digests. Logged by hand for
          now; auto-gathered by research agents later.
        </p>
      </header>

      <BriefForm clients={clients} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Filter:</span>
          <FilterChip href="/briefs" active={!clientFilter && !typeFilter}>
            All
          </FilterChip>
          {SOURCE_TYPES.map((t) => (
            <FilterChip
              key={t}
              href={`/briefs?type=${t}`}
              active={typeFilter === t}
            >
              {SOURCE_LABELS[t]}
            </FilterChip>
          ))}
          {activeClientName && (
            <span className="chip border-indigo-200 bg-indigo-50 text-indigo-700">
              Client: {activeClientName}
              <Link href="/briefs" className="ml-1 text-indigo-400">
                ✕
              </Link>
            </span>
          )}
        </div>

        {briefs.length === 0 ? (
          <p className="card text-sm text-slate-500">
            No briefs match. Add one above.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {briefs.map((b) => (
              <BriefCard key={b.id} brief={b} />
            ))}
          </div>
        )}
      </section>
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
