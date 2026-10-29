import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  updateAgent,
  deleteAgent,
  deleteAgentSource,
  addAgentBrief,
  deleteAgentBrief,
  runAgentBrief,
  runAgent,
  addAgentWhere,
} from "@/app/actions/agents";
import SubmitButton from "@/components/SubmitButton";
import AutoRefresh from "@/components/AutoRefresh";
import { formatDate } from "@/lib/format";
import { PageHeader, Tabs, Section, Advanced, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

function costLabel(cents: number): string {
  return `~£${(cents / 100).toFixed(2)}`;
}

// Turn a diagnostic reason code into a plain-English hint in run history.
function runStatusLabel(r: {
  status: string;
  message: string | null;
  foundCount: number;
  highCount: number;
  medCount: number;
  lowCount: number;
}): string {
  if (r.status === "running") return "Running…";
  if (r.status === "error") return `Error — ${r.message ?? "failed"}`;
  if (r.status === "nothing_new")
    return `Nothing new${r.message ? ` — ${runReason(r.message)}` : ""}`;
  return `Found ${r.foundCount} · ${r.highCount} high / ${r.medCount} med / ${r.lowCount} low`;
}

function runReason(message: string): string {
  if (message === "paused")
    return "search ran long and didn't finish (paused)";
  if (message === "no_text") return "the model returned no answer";
  if (message === "no_items") return "no news";
  if (message.startsWith("parse_failed"))
    return "the model replied in prose, not the expected format";
  return message;
}

// Parse the JSON per-source breakdown stored on a run; empty on any problem.
function parseRunDetail(
  detail: string | null,
): { label: string; created: number; reason?: string }[] {
  if (!detail) return [];
  try {
    const parsed = JSON.parse(detail);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default async function AgentDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const agent = await prisma.agent.findUnique({
    where: { id: params.id },
    include: {
      sources: { orderBy: { createdAt: "asc" } },
      briefs: { orderBy: { createdAt: "asc" } },
      runs: { orderBy: { ranAt: "desc" }, take: 20 },
      _count: { select: { findings: { where: { status: "pending" } } } },
    },
  });
  if (!agent) notFound();

  const tab = searchParams.tab === "runs" ? "runs" : "setup";
  const running = agent.runs[0]?.status === "running";
  const waiting = agent._count.findings;

  return (
    <div className="space-y-5">
      <AutoRefresh active={running} />
      <PageHeader
        back={{ href: "/agents", label: "Agents" }}
        title={agent.name}
        action={
          <>
            {waiting > 0 && (
              <Link href={`/research?agent=${agent.id}`} className="text-xs text-indigo-600 hover:underline">
                {waiting} in the inbox →
              </Link>
            )}
            <form action={runAgent}>
              <input type="hidden" name="id" value={agent.id} />
              <SubmitButton pendingLabel="Starting…" disabled={running}>
                {running ? "Running…" : "Run now"}
              </SubmitButton>
            </form>
          </>
        }
      />

      <Tabs
        tabs={[
          { key: "setup", label: "Setup" },
          { key: "runs", label: "Runs", count: agent.runs.length },
        ]}
        active={tab}
        base={`/agents/${agent.id}`}
      />

      {tab === "setup" ? (
        <>
          <form action={updateAgent} className="card space-y-3">
            <input type="hidden" name="id" value={agent.id} />
            <label className="label">
              Name
              <input name="name" defaultValue={agent.name} className="field mt-1" required />
            </label>
            <label className="label">
              What to look for
              <textarea
                name="briefing"
                rows={6}
                defaultValue={agent.briefing}
                placeholder="e.g. CCH Tagetik releases and roadmap: new modules, pricing, end-of-support notices. Not marketing or events."
                className="field mt-1"
              />
            </label>
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            </div>
          </form>

          <Section title="Where to look">
            <div className="card space-y-3">
              {agent.sources.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {agent.sources.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
                      title={s.type === "rss" ? s.url : (s.query ?? "")}
                    >
                      {s.type === "rss" && <span className="text-[10px] uppercase text-slate-400">feed</span>}
                      {s.name}
                      <form action={deleteAgentSource}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="agentId" value={agent.id} />
                        <button type="submit" className="text-slate-400 hover:text-rose-600" aria-label={`Remove ${s.name}`}>
                          ✕
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addAgentWhere} className="flex items-end gap-2">
                <input type="hidden" name="agentId" value={agent.id} />
                <input name="where" placeholder="A topic, or a feed address (…/feed.xml)" className="field" required />
                <SubmitButton className="btn-ghost whitespace-nowrap" pendingLabel="Adding…">
                  + Add
                </SubmitButton>
              </form>
            </div>
          </Section>

          <Advanced>
            <form action={updateAgent} className="space-y-3">
              <input type="hidden" name="id" value={agent.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="label sm:col-span-2">
                  Mission (one line)
                  <input name="mission" defaultValue={agent.mission} className="field mt-1" />
                </label>
                <label className="label">
                  Only these sites
                  <input
                    name="allowedDomains"
                    defaultValue={agent.allowedDomains ?? ""}
                    placeholder="efrag.org, ifrs.org"
                    className="field mt-1"
                  />
                </label>
                <label className="label">
                  Never these sites
                  <input name="blockedDomains" defaultValue={agent.blockedDomains ?? ""} className="field mt-1" />
                </label>
                <label className="label">
                  Most items per run
                  <input name="maxItems" type="number" min="1" max="20" defaultValue={agent.maxItems} className="field mt-1" />
                </label>
                <label className="label">
                  Look back (days)
                  <input
                    name="lookbackDays"
                    type="number"
                    min="1"
                    max="365"
                    defaultValue={agent.lookbackDays}
                    className="field mt-1"
                  />
                </label>
              </div>
              <div className="flex justify-end">
                <SubmitButton className="btn-ghost" pendingLabel="Saving…">
                  Save
                </SubmitButton>
              </div>
            </form>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <h3 className="text-sm font-medium text-slate-800">Reference files ({agent.briefs.length})</h3>
              {agent.briefs.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {agent.briefs.map((b) => (
                    <li key={b.id} className="flex items-center gap-2 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-slate-800">{b.name}</span>
                        <span className="text-xs text-slate-400">
                          {b.lastRunAt ? `Researched ${formatDate(b.lastRunAt)}` : "Not researched yet"}
                        </span>
                      </span>
                      <form action={runAgentBrief}>
                        <input type="hidden" name="id" value={b.id} />
                        <SubmitButton className="btn-ghost py-1" pendingLabel="Researching…">
                          Run now
                        </SubmitButton>
                      </form>
                      <form action={deleteAgentBrief}>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="agentId" value={agent.id} />
                        <button type="submit" className="text-xs text-slate-400 hover:text-rose-600">
                          Remove
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addAgentBrief} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="agentId" value={agent.id} />
                <input name="name" placeholder="Name" className="field" />
                <input name="file" type="file" accept=".pdf,.docx,.txt" className="field py-1.5 text-xs" />
                <textarea name="content" rows={2} placeholder="…or paste the text" className="field sm:col-span-2" />
                <div className="flex justify-end sm:col-span-2">
                  <SubmitButton className="btn-ghost" pendingLabel="Adding…">
                    Add reference file
                  </SubmitButton>
                </div>
              </form>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-400">
              <span>Type: {agent.archetype}</span>
              <form action={deleteAgent}>
                <input type="hidden" name="id" value={agent.id} />
                <button type="submit" className="text-rose-600 hover:underline">
                  Delete this agent
                </button>
              </form>
            </div>
          </Advanced>
        </>
      ) : agent.runs.length === 0 ? (
        <EmptyState>No runs yet.</EmptyState>
      ) : (
        <ul className="card divide-y divide-slate-100 p-0">
          {agent.runs.map((r) => {
            const perSource = parseRunDetail(r.detail);
            return (
              <li key={r.id} className="px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-36 text-xs text-slate-400">{formatDate(r.ranAt)}</span>
                  <span className={`flex-1 ${r.status === "error" ? "text-rose-700" : "text-slate-700"}`}>
                    {runStatusLabel(r)}
                  </span>
                  <span className="text-xs text-slate-400">{costLabel(r.estCostCents)}</span>
                </div>
                {perSource.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-36 text-xs text-slate-400">
                    {perSource.map((s, i) => (
                      <li key={i}>
                        <span className="text-slate-500">{s.label}:</span> {s.created}
                        {s.created === 0 && s.reason ? ` (${runReason(s.reason)})` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
