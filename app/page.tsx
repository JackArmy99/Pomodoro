import Link from "next/link";
import { prisma } from "@/lib/db";
import BriefCard from "@/components/BriefCard";
import OpportunityCard from "@/components/OpportunityCard";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [recentBriefs, openOpps, counts, pipelineValue] = await Promise.all([
    prisma.brief.findMany({
      include: { clients: { include: { client: true } } },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    prisma.opportunity.findMany({
      where: { stage: { in: ["open", "pursuing"] } },
      include: { client: true, originBrief: true },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
    Promise.all([
      prisma.client.count(),
      prisma.brief.count(),
      prisma.opportunity.count({ where: { stage: { in: ["open", "pursuing"] } } }),
    ]),
    prisma.opportunity.aggregate({
      where: { stage: { in: ["open", "pursuing"] } },
      _sum: { value: true },
    }),
  ]);

  const [clientCount, briefCount, openOppCount] = counts;

  const stats = [
    { label: "Clients & prospects", value: clientCount, href: "/clients" },
    { label: "Briefs logged", value: briefCount, href: "/briefs" },
    { label: "Open opportunities", value: openOppCount, href: "/opportunities" },
    {
      label: "Open pipeline value",
      value: formatMoney(pipelineValue._sum.value ?? 0),
      href: "/opportunities",
    },
  ];

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-lg font-semibold text-slate-900">Hub overview</h1>
        <p className="text-sm text-slate-500">
          Your centralised view of vendor intelligence and client
          opportunities.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Link key={s.label} href={s.href} className="card hover:border-indigo-300">
              <div className="text-2xl font-semibold text-slate-900">
                {s.value}
              </div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Latest briefs</h2>
          <Link href="/briefs" className="text-xs text-indigo-600 hover:underline">
            View all →
          </Link>
        </div>
        {recentBriefs.length === 0 ? (
          <EmptyState
            message="No briefs yet."
            cta={{ href: "/briefs", label: "Add your first brief" }}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {recentBriefs.map((b) => (
              <BriefCard key={b.id} brief={b} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Open opportunities
          </h2>
          <Link
            href="/opportunities"
            className="text-xs text-indigo-600 hover:underline"
          >
            View pipeline →
          </Link>
        </div>
        {openOpps.length === 0 ? (
          <EmptyState
            message="No open opportunities."
            cta={{ href: "/opportunities", label: "Add an opportunity" }}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {openOpps.map((o) => (
              <OpportunityCard key={o.id} opportunity={o} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({
  message,
  cta,
}: {
  message: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="card flex items-center justify-between text-sm text-slate-500">
      <span>{message}</span>
      <Link href={cta.href} className="btn-ghost">
        {cta.label}
      </Link>
    </div>
  );
}
