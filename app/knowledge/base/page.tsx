import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// The knowledge base: one topic tree per module, built from its manual.
export default async function KnowledgeBasePage() {
  const [modules, topics, manuals] = await Promise.all([
    prisma.module.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.kbTopic.groupBy({ by: ["moduleId", "status"], _count: true }),
    prisma.knowledgeSource.findMany({
      where: { kind: "document", docType: "manual", moduleId: { not: null } },
      select: { id: true, title: true, moduleId: true, _count: { select: { versions: true } } },
    }),
  ]);

  const count = (moduleId: string, status?: string) =>
    topics
      .filter((t) => t.moduleId === moduleId && (!status || t.status === status))
      .reduce((n, t) => n + t._count, 0);

  return (
    <div className="space-y-6">
      <Link href="/knowledge" className="text-xs text-indigo-600 hover:underline">
        ← Knowledge
      </Link>
      <header>
        <h1 className="text-lg font-semibold text-slate-900">Knowledge base</h1>
        <p className="text-sm text-slate-500">
          One topic tree per module, built from the module&apos;s manual. Manuals
          are the backbone; webinars and other sources will be filed under these
          topics without ever overwriting them. Nothing here uses AI.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => {
          const total = count(m.id);
          const drafts = count(m.id, "draft");
          const mine = manuals.filter((x) => x.moduleId === m.id);
          return (
            <li key={m.id} className="card space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{m.name}</span>
                {total > 0 && (
                  <span
                    className={`chip ${
                      drafts
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {drafts ? `${drafts} to review` : "Approved"}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {total ? `${total} topics` : "No topic tree yet"}
                {mine.length
                  ? ` · manual: ${mine.map((x) => `${x.title} (${x._count.versions} edition${x._count.versions === 1 ? "" : "s"})`).join(", ")}`
                  : " · no manual imported"}
              </p>
              {total > 0 ? (
                <Link href={`/knowledge/base/${m.id}`} className="text-xs font-medium text-indigo-600 hover:underline">
                  Open the tree →
                </Link>
              ) : mine[0] ? (
                <Link href={`/knowledge/${mine[0].id}`} className="text-xs font-medium text-indigo-600 hover:underline">
                  Build it from the manual →
                </Link>
              ) : (
                <Link href="/knowledge" className="text-xs text-slate-500 hover:underline">
                  Import its manual on the Knowledge page
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
