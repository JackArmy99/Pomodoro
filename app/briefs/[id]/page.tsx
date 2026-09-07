import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { createOpportunityQuick } from "@/app/actions/opportunities";
import {
  formatDate,
  SOURCE_LABELS,
  MODULE_STATUS_LABELS,
  MODULE_STATUS_STYLES,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BriefDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const brief = await prisma.brief.findUnique({
    where: { id: params.id },
    include: {
      modules: { include: { module: true } },
      clients: { include: { client: true } },
    },
  });

  if (!brief) notFound();

  const moduleIds = brief.modules.map((bm) => bm.moduleId);

  // Clients affected because they run / are licensed for a tagged module.
  const affectedLinks =
    moduleIds.length > 0
      ? await prisma.clientModule.findMany({
          where: { moduleId: { in: moduleIds } },
          include: { client: true, module: true },
        })
      : [];

  // Group by client.
  const byClient = new Map<
    string,
    {
      client: { id: string; name: string };
      matches: { module: string; status: string }[];
    }
  >();
  for (const link of affectedLinks) {
    const entry = byClient.get(link.clientId) ?? {
      client: link.client,
      matches: [],
    };
    entry.matches.push({ module: link.module.name, status: link.status });
    byClient.set(link.clientId, entry);
  }
  const affected = Array.from(byClient.values()).sort((a, b) =>
    a.client.name.localeCompare(b.client.name),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/briefs" className="text-xs text-indigo-600 hover:underline">
          ← All briefs
        </Link>
      </div>

      <article className="card">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="chip border-indigo-100 bg-indigo-50 text-indigo-700">
            {SOURCE_LABELS[brief.sourceType] ?? brief.sourceType}
          </span>
          <span className="text-xs text-slate-400">
            {formatDate(brief.publishedAt ?? brief.createdAt)}
          </span>
        </div>
        <h1 className="text-lg font-semibold text-slate-900">{brief.title}</h1>
        {brief.summary && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
            {brief.summary}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {brief.modules.map((bm) => (
            <span
              key={bm.moduleId}
              className="chip border-indigo-100 bg-indigo-50 text-indigo-600"
            >
              {bm.module.name}
            </span>
          ))}
        </div>
        {brief.sourceUrl && (
          <a
            href={brief.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-xs font-medium text-indigo-600 hover:underline"
          >
            View source ↗
          </a>
        )}
      </article>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Clients affected ({affected.length})
        </h2>
        {moduleIds.length === 0 ? (
          <p className="card text-sm text-slate-500">
            Tag this brief with the module(s) it’s about (edit it from the feed)
            to see which clients are affected.
          </p>
        ) : affected.length === 0 ? (
          <p className="card text-sm text-slate-500">
            No clients run or are licensed for these modules.
          </p>
        ) : (
          affected.map(({ client, matches }) => {
            const summary = matches
              .map((m) => `${m.module} (${MODULE_STATUS_LABELS[m.status]})`)
              .join(", ");
            return (
              <div
                key={client.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/clients/${client.id}`}
                    className="text-sm font-medium text-slate-900 hover:underline"
                  >
                    {client.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {matches.map((m) => (
                      <span
                        key={m.module}
                        className={`chip ${MODULE_STATUS_STYLES[m.status]}`}
                      >
                        {m.module} · {MODULE_STATUS_LABELS[m.status]}
                      </span>
                    ))}
                  </div>
                </div>
                <form action={createOpportunityQuick}>
                  <input type="hidden" name="clientId" value={client.id} />
                  <input
                    type="hidden"
                    name="title"
                    value={`${brief.title} — ${client.name}`}
                  />
                  <input
                    type="hidden"
                    name="description"
                    value={`From brief “${brief.title}”. Affected: ${summary}.`}
                  />
                  <input type="hidden" name="originBriefId" value={brief.id} />
                  <button type="submit" className="btn-ghost whitespace-nowrap">
                    → Create opportunity
                  </button>
                </form>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
