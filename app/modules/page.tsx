import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ModulesPage() {
  const modules = await prisma.module.findMany({
    orderBy: { name: "asc" },
    include: { clients: true },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold text-slate-900">
          Modules &amp; licences
        </h1>
        <p className="text-sm text-slate-500">
          Who runs what. Click a module to see exactly which clients use it or
          are licensed for it — your “who’s affected?” lookup.
        </p>
      </header>

      {modules.length === 0 ? (
        <p className="card text-sm text-slate-500">No modules yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => {
            const inUse = m.clients.filter((c) => c.status === "in_use").length;
            const licensed = m.clients.filter(
              (c) => c.status === "licensed",
            ).length;
            return (
              <li key={m.id}>
                <Link
                  href={`/modules/${m.id}`}
                  className="card block hover:border-indigo-300"
                >
                  <div className="font-medium text-slate-900">{m.name}</div>
                  <div className="mt-2 flex gap-2 text-xs">
                    <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">
                      {inUse} in use
                    </span>
                    <span className="chip border-amber-200 bg-amber-50 text-amber-700">
                      {licensed} licensed
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
