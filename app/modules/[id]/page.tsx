import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import ClientBadge from "@/components/ClientBadge";

export const dynamic = "force-dynamic";

export default async function ModuleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const mod = await prisma.module.findUnique({
    where: { id: params.id },
    include: { clients: { include: { client: true } } },
  });

  if (!mod) notFound();

  const inUse = mod.clients
    .filter((c) => c.status === "in_use")
    .map((c) => c.client);
  const licensed = mod.clients
    .filter((c) => c.status === "licensed")
    .map((c) => c.client);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/modules" className="text-xs text-indigo-600 hover:underline">
          ← All modules
        </Link>
      </div>

      <header>
        <h1 className="text-lg font-semibold text-slate-900">{mod.name}</h1>
        <p className="text-sm text-slate-500">
          Clients affected by anything relating to this module.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-emerald-700">
          In use ({inUse.length})
        </h2>
        {inUse.length === 0 ? (
          <p className="card text-sm text-slate-500">No clients using this.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {inUse.map((c) => (
              <ClientBadge key={c.id} client={c} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-amber-700">
          Licensed but not in use ({licensed.length})
          <span className="ml-2 text-xs font-normal text-slate-400">
            upsell openings
          </span>
        </h2>
        {licensed.length === 0 ? (
          <p className="card text-sm text-slate-500">None.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {licensed.map((c) => (
              <ClientBadge key={c.id} client={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
