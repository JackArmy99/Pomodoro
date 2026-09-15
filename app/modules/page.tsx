import Link from "next/link";
import { prisma } from "@/lib/db";
import { setProductContext } from "@/app/actions/modules";

export const dynamic = "force-dynamic";

export default async function ModulesPage() {
  const [modules, productContext] = await Promise.all([
    prisma.module.findMany({
      orderBy: { name: "asc" },
      include: { clients: true },
    }),
    prisma.setting.findUnique({ where: { key: "product_context" } }),
  ]);

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

      {/* Product context — grounds every research run. */}
      <form action={setProductContext} className="card space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Product context{" "}
          <span className="font-normal text-slate-400">
            (what the agents are told about CCH Tagetik)
          </span>
        </h2>
        <p className="text-xs text-slate-500">
          Injected into every research run so findings map to the right modules.
          Edit freely — you know Tagetik better than the draft does.
        </p>
        <textarea
          name="value"
          rows={6}
          defaultValue={productContext?.value ?? ""}
          className="field"
        />
        <div className="flex justify-end">
          <button type="submit" className="btn">
            Save context
          </button>
        </div>
      </form>

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
                  {m.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                      {m.description}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs italic text-amber-600">
                      No description — add one to improve mapping
                    </p>
                  )}
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
