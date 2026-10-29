import type { PrismaClient, Prisma } from "@prisma/client";
import { logEvent, logEvents, type KbEventInput } from "@/lib/kb/events";
import { isManualTier } from "@/lib/knowledge/authority";

// Jack's module → topic tree (docs/knowledge-base-plan.md §3).
//
// The first manual for a module PROPOSES the tree: one draft topic per section
// down to MAX_PROPOSED_DEPTH, deeper sections filed under their nearest
// proposed ancestor. Jack renames, reorders, nests, merges and approves; every
// change is a KbEvent. No model call anywhere in here.

type Db = PrismaClient | Prisma.TransactionClient;

export const MAX_PROPOSED_DEPTH = 2;
export const MAX_DEPTH = 3;

export type Result = { ok: true; id?: string; count?: number } | { ok: false; error: string };

// ---- Proposing a tree from a manual edition --------------------------------

export async function proposeTree(
  db: PrismaClient,
  opts: { sourceVersionId: string; moduleId: string; actor: string; maxDepth?: number },
): Promise<Result> {
  const maxDepth = opts.maxDepth ?? MAX_PROPOSED_DEPTH;
  // Rule in code: only a manual (tier 1) may lay down the backbone.
  const version = await db.sourceVersion.findUnique({
    where: { id: opts.sourceVersionId },
    select: { source: { select: { authority: true } } },
  });
  if (!version) return { ok: false, error: "That edition wasn't found." };
  if (!isManualTier(version.source.authority)) {
    return { ok: false, error: "Only a manual can build the topic tree." };
  }
  const existing = await db.kbTopic.count({ where: { moduleId: opts.moduleId } });
  if (existing > 0) {
    // A second manual (or edition) maps onto the tree; it never replaces it.
    return { ok: false, error: "This module already has a topic tree." };
  }
  const sections = await db.docSection.findMany({
    where: { sourceVersionId: opts.sourceVersionId },
    orderBy: { ordinal: "asc" },
  });
  if (sections.length === 0) {
    return { ok: false, error: "This manual has no table of contents to build from." };
  }

  return db.$transaction(
    async (tx) => {
      // stack[level-1] = the topic proposed for the nearest section at that level
      const stack: (string | null)[] = [];
      const orderUnder = new Map<string, number>();
      const events: KbEventInput[] = [];
      let created = 0;

      for (const sec of sections) {
        stack.length = Math.min(stack.length, sec.level - 1);
        if (sec.level <= maxDepth) {
          const parentId = sec.level > 1 ? stack[sec.level - 2] ?? null : null;
          const key = parentId ?? "root";
          const order = orderUnder.get(key) ?? 0;
          orderUnder.set(key, order + 1);
          const topic = await tx.kbTopic.create({
            data: {
              moduleId: opts.moduleId,
              parentId,
              title: sec.title,
              order,
              createdFrom: opts.sourceVersionId,
            },
          });
          created++;
          stack[sec.level - 1] = topic.id;
          await tx.docSection.update({ where: { id: sec.id }, data: { topicId: topic.id } });
          events.push({
            actor: opts.actor,
            entityType: "topic",
            entityId: topic.id,
            action: "proposed",
            after: { title: sec.title, parentId, fromSection: sec.path, page: sec.page },
            sourceVersionId: opts.sourceVersionId,
            moduleId: opts.moduleId,
          });
        } else {
          // Deeper than the proposed tree: filed under its nearest ancestor.
          const owner = [...stack].reverse().find(Boolean) ?? null;
          await tx.docSection.update({ where: { id: sec.id }, data: { topicId: owner } });
        }
      }

      events.push({
        actor: opts.actor,
        entityType: "tree",
        entityId: opts.moduleId,
        action: "proposed",
        after: { topics: created, sections: sections.length, maxDepth },
        sourceVersionId: opts.sourceVersionId,
        moduleId: opts.moduleId,
      });
      await logEvents(tx, events);
      return { ok: true as const, count: created };
    },
    { timeout: 60_000 },
  );
}

// ---- Editing ---------------------------------------------------------------

async function topicOr(db: Db, id: string) {
  return db.kbTopic.findUnique({ where: { id } });
}

async function siblings(db: Db, moduleId: string, parentId: string | null) {
  return db.kbTopic.findMany({ where: { moduleId, parentId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
}

// Renumber a sibling list 0..n in the given order.
async function renumber(db: Db, ids: string[]) {
  for (let i = 0; i < ids.length; i++) {
    await db.kbTopic.update({ where: { id: ids[i] }, data: { order: i } });
  }
}

async function depthOf(db: Db, id: string | null): Promise<number> {
  let d = 0;
  let cur = id;
  while (cur) {
    d++;
    const t = await db.kbTopic.findUnique({ where: { id: cur }, select: { parentId: true } });
    cur = t?.parentId ?? null;
  }
  return d;
}

async function heightOf(db: Db, id: string): Promise<number> {
  const kids = await db.kbTopic.findMany({ where: { parentId: id }, select: { id: true } });
  let h = 0;
  for (const k of kids) h = Math.max(h, await heightOf(db, k.id));
  return h + 1;
}

export async function renameTopic(db: PrismaClient, id: string, title: string, actor = "jack"): Promise<Result> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!clean) return { ok: false, error: "A topic needs a name." };
  const t = await topicOr(db, id);
  if (!t) return { ok: false, error: "Topic not found." };
  if (t.title === clean) return { ok: true, id };
  await db.$transaction(async (tx) => {
    await tx.kbTopic.update({ where: { id }, data: { title: clean } });
    await logEvent(tx, { actor, entityType: "topic", entityId: id, action: "renamed",
      before: { title: t.title }, after: { title: clean }, moduleId: t.moduleId });
  });
  return { ok: true, id };
}

export async function moveTopic(db: PrismaClient, id: string, dir: "up" | "down", actor = "jack"): Promise<Result> {
  const t = await topicOr(db, id);
  if (!t) return { ok: false, error: "Topic not found." };
  await db.$transaction(async (tx) => {
    const list = (await siblings(tx, t.moduleId, t.parentId)).map((s) => s.id);
    const i = list.indexOf(id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await renumber(tx, list);
    await logEvent(tx, { actor, entityType: "topic", entityId: id, action: "moved",
      before: { position: i }, after: { position: j }, moduleId: t.moduleId });
  });
  return { ok: true, id };
}

// Nest under the topic just above it.
export async function indentTopic(db: PrismaClient, id: string, actor = "jack"): Promise<Result> {
  const t = await topicOr(db, id);
  if (!t) return { ok: false, error: "Topic not found." };
  const list = await siblings(db, t.moduleId, t.parentId);
  const i = list.findIndex((s) => s.id === id);
  if (i <= 0) return { ok: false, error: "There is no topic above it to nest under." };
  const newParent = list[i - 1];
  if ((await depthOf(db, newParent.id)) + (await heightOf(db, id)) > MAX_DEPTH) {
    return { ok: false, error: `Topics go at most ${MAX_DEPTH} levels deep.` };
  }
  await db.$transaction(async (tx) => {
    const under = await siblings(tx, t.moduleId, newParent.id);
    await tx.kbTopic.update({ where: { id }, data: { parentId: newParent.id, order: under.length } });
    await renumber(tx, list.filter((s) => s.id !== id).map((s) => s.id));
    await logEvent(tx, { actor, entityType: "topic", entityId: id, action: "nested",
      before: { parentId: t.parentId }, after: { parentId: newParent.id }, moduleId: t.moduleId });
  });
  return { ok: true, id };
}

// Move up a level, to sit just after its old parent.
export async function outdentTopic(db: PrismaClient, id: string, actor = "jack"): Promise<Result> {
  const t = await topicOr(db, id);
  if (!t) return { ok: false, error: "Topic not found." };
  if (!t.parentId) return { ok: false, error: "It is already at the top level." };
  const parent = await topicOr(db, t.parentId);
  if (!parent) return { ok: false, error: "Parent topic not found." };
  await db.$transaction(async (tx) => {
    const outer = (await siblings(tx, t.moduleId, parent.parentId)).map((s) => s.id);
    outer.splice(outer.indexOf(parent.id) + 1, 0, id);
    await tx.kbTopic.update({ where: { id }, data: { parentId: parent.parentId } });
    await renumber(tx, outer);
    const old = (await siblings(tx, t.moduleId, parent.id)).map((s) => s.id);
    await renumber(tx, old);
    await logEvent(tx, { actor, entityType: "topic", entityId: id, action: "un-nested",
      before: { parentId: t.parentId }, after: { parentId: parent.parentId }, moduleId: t.moduleId });
  });
  return { ok: true, id };
}

// Fold a topic into another: its manual sections and sub-topics move across,
// then it is removed. Nothing filed under it is lost.
export async function mergeTopic(db: PrismaClient, id: string, intoId: string, actor = "jack"): Promise<Result> {
  if (id === intoId) return { ok: false, error: "A topic can't be merged into itself." };
  const [t, into] = await Promise.all([topicOr(db, id), topicOr(db, intoId)]);
  if (!t || !into) return { ok: false, error: "Topic not found." };
  if (t.moduleId !== into.moduleId) return { ok: false, error: "Topics are in different modules." };
  // Merging into one of its own descendants would orphan the branch.
  let cur: string | null = into.parentId;
  while (cur) {
    if (cur === id) return { ok: false, error: "A topic can't be merged into one of its own sub-topics." };
    cur = (await topicOr(db, cur))?.parentId ?? null;
  }
  await db.$transaction(async (tx) => {
    const moved = await tx.docSection.updateMany({ where: { topicId: id }, data: { topicId: intoId } });
    const kids = await siblings(tx, t.moduleId, id);
    const base = (await siblings(tx, t.moduleId, intoId)).length;
    for (let k = 0; k < kids.length; k++) {
      await tx.kbTopic.update({ where: { id: kids[k].id }, data: { parentId: intoId, order: base + k } });
    }
    await tx.kbTopic.delete({ where: { id } });
    await renumber(tx, (await siblings(tx, t.moduleId, t.parentId)).map((s) => s.id));
    await logEvent(tx, { actor, entityType: "topic", entityId: id, action: "merged",
      before: { title: t.title, parentId: t.parentId },
      after: { into: intoId, intoTitle: into.title, sections: moved.count, subTopics: kids.length },
      moduleId: t.moduleId });
  });
  return { ok: true, id: intoId };
}

// Only an empty topic can be deleted; one holding manual sections is merged,
// so its content always has somewhere to go.
export async function deleteTopic(db: PrismaClient, id: string, actor = "jack"): Promise<Result> {
  const t = await topicOr(db, id);
  if (!t) return { ok: false, error: "Topic not found." };
  const [secs, kids] = await Promise.all([
    db.docSection.count({ where: { topicId: id } }),
    db.kbTopic.count({ where: { parentId: id } }),
  ]);
  if (secs || kids) return { ok: false, error: "It holds manual sections or sub-topics — merge it into another topic instead." };
  await db.$transaction(async (tx) => {
    await tx.kbTopic.delete({ where: { id } });
    await renumber(tx, (await siblings(tx, t.moduleId, t.parentId)).map((s) => s.id));
    await logEvent(tx, { actor, entityType: "topic", entityId: id, action: "deleted",
      before: { title: t.title, parentId: t.parentId }, moduleId: t.moduleId });
  });
  return { ok: true };
}

export async function addTopic(
  db: PrismaClient,
  moduleId: string,
  parentId: string | null,
  title: string,
  actor = "jack",
): Promise<Result> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!clean) return { ok: false, error: "A topic needs a name." };
  if (parentId && (await depthOf(db, parentId)) + 1 > MAX_DEPTH) {
    return { ok: false, error: `Topics go at most ${MAX_DEPTH} levels deep.` };
  }
  return db.$transaction(async (tx) => {
    const order = (await siblings(tx, moduleId, parentId)).length;
    const topic = await tx.kbTopic.create({ data: { moduleId, parentId, title: clean, order } });
    await logEvent(tx, { actor, entityType: "topic", entityId: topic.id, action: "created",
      after: { title: clean, parentId }, moduleId });
    return { ok: true as const, id: topic.id };
  });
}

// Jack's sign-off: every draft topic in the module becomes approved.
export async function approveTree(db: PrismaClient, moduleId: string, actor = "jack"): Promise<Result> {
  return db.$transaction(async (tx) => {
    const res = await tx.kbTopic.updateMany({ where: { moduleId, status: "draft" }, data: { status: "approved" } });
    if (res.count) {
      await logEvent(tx, { actor, entityType: "tree", entityId: moduleId, action: "approved",
        after: { topics: res.count }, moduleId });
    }
    return { ok: true as const, count: res.count };
  });
}

// ---- Reading ---------------------------------------------------------------

export type TopicNode = {
  id: string;
  title: string;
  status: string;
  order: number;
  parentId: string | null;
  sections: number;
  firstPage: number | null;
  lastPage: number | null;
  children: TopicNode[];
};

export async function topicTree(db: PrismaClient, moduleId: string): Promise<TopicNode[]> {
  const topics = await db.kbTopic.findMany({
    where: { moduleId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { sections: { select: { page: true } } },
  });
  const nodes = new Map<string, TopicNode>();
  for (const t of topics) {
    const pages = t.sections.map((s) => s.page).filter((p): p is number => p != null);
    nodes.set(t.id, {
      id: t.id,
      title: t.title,
      status: t.status,
      order: t.order,
      parentId: t.parentId,
      sections: t.sections.length,
      firstPage: pages.length ? Math.min(...pages) : null,
      lastPage: pages.length ? Math.max(...pages) : null,
      children: [],
    });
  }
  const roots: TopicNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : null;
    (parent ? parent.children : roots).push(n);
  }
  return roots;
}
