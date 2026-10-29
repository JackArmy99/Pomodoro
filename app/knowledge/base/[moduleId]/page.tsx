import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { topicTree, MAX_DEPTH, type TopicNode } from "@/lib/kb/topics";
import {
  renameTopicAction,
  moveTopicAction,
  mergeTopicAction,
  deleteTopicAction,
  addTopicAction,
  approveTreeAction,
} from "@/app/actions/kb";
import SubmitButton from "@/components/SubmitButton";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// A module's topic tree: proposed from its manual's contents, edited and
// approved by Jack. Every change is logged in the history at the bottom.
export default async function TopicTreePage({
  params,
  searchParams,
}: {
  params: { moduleId: string };
  searchParams: { error?: string };
}) {
  const mod = await prisma.module.findUnique({ where: { id: params.moduleId } });
  if (!mod) notFound();

  const [tree, events, drafts, manual] = await Promise.all([
    topicTree(prisma, mod.id),
    prisma.kbEvent.findMany({ where: { moduleId: mod.id }, orderBy: { at: "desc" }, take: 40 }),
    prisma.kbTopic.count({ where: { moduleId: mod.id, status: "draft" } }),
    prisma.knowledgeSource.findFirst({
      where: { kind: "document", docType: "manual", moduleId: mod.id },
      select: { id: true, title: true },
    }),
  ]);
  const total = countNodes(tree);

  return (
    <div className="space-y-6">
      <Link href="/knowledge/base" className="text-xs text-indigo-600 hover:underline">
        ← Knowledge base
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{mod.name} — topics</h1>
          <p className="text-sm text-slate-500">
            {total} topics
            {manual && (
              <>
                {" "}from{" "}
                <Link href={`/knowledge/${manual.id}`} className="text-indigo-600 hover:underline">
                  {manual.title}
                </Link>
              </>
            )}
            . Rename by typing and pressing Enter. ↑↓ reorder, → nests under the
            topic above, ← moves up a level. Merging keeps everything filed under
            the topic. Up to {MAX_DEPTH} levels.
          </p>
        </div>
        {drafts > 0 ? (
          <form action={approveTreeAction}>
            <input type="hidden" name="moduleId" value={mod.id} />
            <SubmitButton className="btn whitespace-nowrap" pendingLabel="Approving…">
              Approve the tree ({drafts} draft)
            </SubmitButton>
          </form>
        ) : total > 0 ? (
          <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">Approved</span>
        ) : null}
      </header>

      {searchParams.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {searchParams.error}
        </p>
      )}

      {total === 0 ? (
        <p className="card text-sm text-slate-500">
          No topics yet. Open the module&apos;s manual on the Knowledge page and
          press “Build the topic tree from this”.
        </p>
      ) : (
        <section className="card divide-y divide-slate-100 p-0">
          {tree.map((n, i) => (
            <Branch key={n.id} node={n} depth={1} first={i === 0} last={i === tree.length - 1} />
          ))}
        </section>
      )}

      <form action={addTopicAction} className="card flex flex-wrap items-end gap-2">
        <input type="hidden" name="moduleId" value={mod.id} />
        <label className="flex-1 space-y-1 text-xs text-slate-500">
          <span>Add a top-level topic</span>
          <input name="title" className="field" placeholder="e.g. Intercompany" required />
        </label>
        <SubmitButton className="btn-ghost" pendingLabel="Adding…">
          Add
        </SubmitButton>
      </form>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">History</h2>
        {events.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="card space-y-1 text-xs">
            {events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-28 shrink-0 text-slate-400">{formatDate(e.at)}</span>
                <span className="text-slate-700">{describe(e)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function countNodes(nodes: TopicNode[]): number {
  return nodes.reduce((n, x) => n + 1 + countNodes(x.children), 0);
}

function Branch({ node, depth, first, last }: { node: TopicNode; depth: number; first: boolean; last: boolean }) {
  const row = <Row node={node} depth={depth} first={first} last={last} />;
  if (!node.children.length) return row;
  const kids = node.children.map((c, i) => (
    <Branch key={c.id} node={c} depth={depth + 1} first={i === 0} last={i === node.children.length - 1} />
  ));
  // Flat, not <details>: typing a space in a rename box inside a <summary>
  // would fold the branch.
  return (
    <>
      {row}
      {kids}
    </>
  );
}

function Row({ node, depth, first, last }: { node: TopicNode; depth: number; first: boolean; last: boolean }) {
  const pages =
    node.firstPage == null
      ? null
      : node.firstPage === node.lastPage
        ? `p.${node.firstPage}`
        : `pp.${node.firstPage}–${node.lastPage}`;
  const empty = node.sections === 0 && node.children.length === 0;
  const Op = ({ op, label, title }: { op: string; label: string; title: string }) => (
    <form action={moveTopicAction}>
      <input type="hidden" name="topicId" value={node.id} />
      <input type="hidden" name="op" value={op} />
      <button className="rounded px-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" title={title}>
        {label}
      </button>
    </form>
  );
  return (
    <div
      id={node.id}
      className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm"
      style={{ paddingLeft: `${0.75 + (depth - 1) * 1.5}rem` }}
    >
      <form action={renameTopicAction} className="min-w-0 flex-1">
        <input type="hidden" name="topicId" value={node.id} />
        <input
          name="title"
          defaultValue={node.title}
          className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-200 focus:border-indigo-300 focus:bg-white ${
            depth === 1 ? "font-medium text-slate-900" : "text-slate-700"
          }`}
        />
      </form>
      <span className="text-xs text-slate-400">
        {node.sections > 0 ? `${node.sections} section${node.sections === 1 ? "" : "s"}` : "empty"}
        {pages ? ` · ${pages}` : ""}
      </span>
      {node.status === "draft" && (
        <span className="chip border-amber-200 bg-amber-50 text-[10px] text-amber-700">draft</span>
      )}
      <div className="flex items-center text-xs">
        {!first && <Op op="up" label="↑" title="Move up" />}
        {!last && <Op op="down" label="↓" title="Move down" />}
        {!first && depth < 3 && <Op op="in" label="→" title="Nest under the topic above" />}
        {depth > 1 && <Op op="out" label="←" title="Move up a level" />}
        {!first && (
          <form action={mergeTopicAction}>
            <input type="hidden" name="topicId" value={node.id} />
            <input type="hidden" name="into" value="previous" />
            <button className="rounded px-1.5 text-slate-500 hover:bg-slate-100" title="Merge into the topic above">
              merge ↑
            </button>
          </form>
        )}
        {depth > 1 && (
          <form action={mergeTopicAction}>
            <input type="hidden" name="topicId" value={node.id} />
            <input type="hidden" name="into" value="parent" />
            <button className="rounded px-1.5 text-slate-500 hover:bg-slate-100" title="Merge into its parent topic">
              merge ←
            </button>
          </form>
        )}
        {empty && (
          <form action={deleteTopicAction}>
            <input type="hidden" name="topicId" value={node.id} />
            <button className="rounded px-1.5 text-red-500 hover:bg-red-50" title="Delete (empty topics only)">
              ✕
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// One history line in plain English.
function describe(e: { action: string; entityType: string; actor: string; beforeJson: string | null; afterJson: string | null }): string {
  const b = safe(e.beforeJson);
  const a = safe(e.afterJson);
  const who = e.actor === "jack" ? "You" : "Beacon";
  if (e.entityType === "tree" && e.action === "proposed")
    return `${who} built the tree from the manual: ${a.topics} topics covering ${a.sections} sections.`;
  if (e.entityType === "tree" && e.action === "approved") return `${who} approved ${a.topics} topics.`;
  switch (e.action) {
    case "proposed":
      return `Proposed “${a.title}” (section ${a.fromSection}${a.page ? `, p.${a.page}` : ""}).`;
    case "renamed":
      return `${who} renamed “${b.title}” to “${a.title}”.`;
    case "merged":
      return `${who} merged “${b.title}” into “${a.intoTitle}” (${a.sections} sections, ${a.subTopics} sub-topics moved).`;
    case "deleted":
      return `${who} deleted the empty topic “${b.title}”.`;
    case "created":
      return `${who} added “${a.title}”.`;
    case "moved":
      return `${who} reordered a topic.`;
    case "nested":
      return `${who} nested a topic under another.`;
    case "un-nested":
      return `${who} moved a topic up a level.`;
    default:
      return `${who}: ${e.action} ${e.entityType}.`;
  }
}

function safe(json: string | null): any {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}
