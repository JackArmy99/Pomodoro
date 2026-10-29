"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { isManualTier } from "@/lib/knowledge/authority";
import {
  proposeTree,
  renameTopic,
  moveTopic,
  indentTopic,
  outdentTopic,
  mergeTopic,
  deleteTopic,
  addTopic,
  approveTree,
  type Result,
} from "@/lib/kb/topics";

// The knowledge base's topic tree. Every change here is logged as a KbEvent by
// lib/kb/topics.ts; nothing calls a model.

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function back(moduleId: string, r: Result, anchor?: string): never {
  revalidatePath(`/library/topics/${moduleId}`);
  revalidatePath("/library/topics");
  const q = r.ok ? "" : `?error=${encodeURIComponent(r.error)}`;
  redirect(`/library/topics/${moduleId}${q}${anchor ? `#${anchor}` : ""}`);
}

// Build a module's first topic tree from a manual's table of contents.
// Only a manual (tier 1) may do this: the tree is the backbone everything
// else is filed under.
export async function proposeTreeFromSource(formData: FormData) {
  const sourceId = str(formData, "sourceId");
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  const fail = (msg: string) => redirect(`/library/${sourceId}?error=${encodeURIComponent(msg)}`);
  if (!source) return fail("Source not found.");
  if (!isManualTier(source.authority)) return fail("Only a manual can build the topic tree. Set “What is it?” to Manual first.");
  if (!source.moduleId) return fail("Choose which module this manual covers first.");
  if (!source.currentVersionId) return fail("This manual hasn't finished importing yet.");

  const r = await proposeTree(prisma, {
    sourceVersionId: source.currentVersionId,
    moduleId: source.moduleId,
    actor: "jack",
    maxDepth: str(formData, "maxDepth") === "2" ? 2 : 1,
  });
  if (!r.ok) return fail(r.error);
  back(source.moduleId, r);
}

async function moduleOf(topicId: string): Promise<string | null> {
  const t = await prisma.kbTopic.findUnique({ where: { id: topicId }, select: { moduleId: true } });
  return t?.moduleId ?? null;
}

export async function renameTopicAction(formData: FormData) {
  const id = str(formData, "topicId");
  const m = await moduleOf(id);
  if (!m) return;
  back(m, await renameTopic(prisma, id, str(formData, "title")), id);
}

export async function moveTopicAction(formData: FormData) {
  const id = str(formData, "topicId");
  const m = await moduleOf(id);
  if (!m) return;
  const op = str(formData, "op");
  let r: Result;
  if (op === "up" || op === "down") r = await moveTopic(prisma, id, op);
  else if (op === "in") r = await indentTopic(prisma, id);
  else if (op === "out") r = await outdentTopic(prisma, id);
  else r = { ok: false, error: "Unknown move." };
  back(m, r, id);
}

// "into" is "parent", "previous" (the topic just above), or a topic id.
export async function mergeTopicAction(formData: FormData) {
  const id = str(formData, "topicId");
  const t = await prisma.kbTopic.findUnique({ where: { id } });
  if (!t) return;
  const into = str(formData, "into");
  let target: string | null = null;
  if (into === "parent") target = t.parentId;
  else if (into === "previous") {
    const prev = await prisma.kbTopic.findFirst({
      where: { moduleId: t.moduleId, parentId: t.parentId, order: { lt: t.order } },
      orderBy: { order: "desc" },
    });
    target = prev?.id ?? null;
  } else target = into || null;
  if (!target) back(t.moduleId, { ok: false, error: "There is nothing to merge it into." }, id);
  back(t.moduleId, await mergeTopic(prisma, id, target), target);
}

export async function deleteTopicAction(formData: FormData) {
  const id = str(formData, "topicId");
  const m = await moduleOf(id);
  if (!m) return;
  back(m, await deleteTopic(prisma, id));
}

export async function addTopicAction(formData: FormData) {
  const moduleId = str(formData, "moduleId");
  const parentId = str(formData, "parentId") || null;
  const r = await addTopic(prisma, moduleId, parentId, str(formData, "title"));
  back(moduleId, r, r.ok ? r.id : undefined);
}

export async function approveTreeAction(formData: FormData) {
  const moduleId = str(formData, "moduleId");
  back(moduleId, await approveTree(prisma, moduleId));
}
