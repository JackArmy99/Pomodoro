"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  fetchAllActiveSources,
  fetchSourceById,
  processFinding,
} from "@/lib/research/fetch";

export async function saveInstructions(formData: FormData) {
  const value = String(formData.get("instructions") ?? "").trim();
  await prisma.setting.upsert({
    where: { key: "research_instructions" },
    create: { key: "research_instructions", value },
    update: { value },
  });
  revalidatePath("/research");
}

export async function createSource(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  if (!name || !url) return;
  const instructions = String(formData.get("instructions") ?? "").trim() || null;

  await prisma.source.create({ data: { name, url, instructions } });
  revalidatePath("/research");
}

export async function deleteSource(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.source.delete({ where: { id } });
  revalidatePath("/research");
}

export async function fetchNow() {
  await fetchAllActiveSources();
  revalidatePath("/research");
}

export async function fetchOneSource(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await fetchSourceById(id);
  revalidatePath("/research");
}

// Manual paste — the bridge for login-gated content you copy in yourself.
export async function ingestPaste(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const rawContent = String(formData.get("content") ?? "").trim();
  if (!title && !rawContent) return;
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim() || null;

  const finding = await prisma.finding.create({
    data: {
      title: title || "(pasted item)",
      rawContent: rawContent.slice(0, 8000),
      sourceUrl,
      sourceType: "paste",
    },
  });

  await processFinding(finding.id); // summarise if a key is configured
  revalidatePath("/research");
}

export async function summariseFinding(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await processFinding(id);
  revalidatePath("/research");
}

export async function dismissFinding(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.finding.update({ where: { id }, data: { status: "dismissed" } });
  revalidatePath("/research");
}

// Approve → turn the finding into a Brief, carrying its suggested modules so
// the "affected clients" flow works immediately.
export async function approveFinding(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const finding = await prisma.finding.findUnique({
    where: { id },
    include: { modules: true },
  });
  if (!finding) return;

  const brief = await prisma.brief.create({
    data: {
      title: finding.title,
      summary: finding.summary || finding.rawContent.slice(0, 600),
      sourceUrl: finding.sourceUrl,
      sourceType: finding.sourceType,
      publishedAt: finding.publishedAt,
      modules: {
        create: finding.modules.map((fm) => ({ moduleId: fm.moduleId })),
      },
    },
  });

  await prisma.finding.update({
    where: { id },
    data: { status: "approved", briefId: brief.id },
  });

  revalidatePath("/research");
  revalidatePath("/briefs");
  revalidatePath("/");
}
