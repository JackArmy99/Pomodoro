"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  fetchAllActiveSources,
  fetchSourceById,
  processFinding,
  researchFromBrief,
} from "@/lib/research/fetch";
import { getYouTubeTranscript } from "@/lib/research/youtube";
import { extractText } from "@/lib/research/extract";

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

  await prisma.source.create({ data: { name, url, type: "rss", instructions } });
  revalidatePath("/research");
}

// A web-research topic: Claude searches the wider internet for this each run.
export async function createWebTopic(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const query = String(formData.get("query") ?? "").trim();
  if (!name || !query) return;
  const instructions = String(formData.get("instructions") ?? "").trim() || null;

  await prisma.source.create({
    data: { name, type: "web", query, instructions },
  });
  revalidatePath("/research");
}

// Ingest a YouTube video: pull its captions and summarise into the inbox.
export async function ingestVideo(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return;

  const existing = await prisma.finding.findUnique({ where: { externalId: url } });
  if (existing) return; // already ingested

  const result = await getYouTubeTranscript(url);
  if (!result) {
    // No captions — leave a note so it's visible; the audio/ASR path comes later.
    await prisma.finding.create({
      data: {
        title: "Video has no captions — needs audio transcription",
        rawContent: `Couldn't get a transcript for ${url}. Once audio transcription (ASR) is set up, capture the audio and upload it.`,
        sourceUrl: url,
        sourceType: "video",
      },
    });
    revalidatePath("/research");
    return;
  }

  const finding = await prisma.finding.create({
    data: {
      title: result.title,
      rawContent: result.text.slice(0, 8000),
      sourceUrl: url,
      sourceType: "video",
      externalId: url,
    },
  });
  await processFinding(finding.id);
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

// Create a research brief from an uploaded file (PDF/Word) or typed text.
export async function createBrief(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const typed = String(formData.get("content") ?? "").trim();
  const file = formData.get("file");

  let content = typed;
  if (file instanceof File && file.size > 0) {
    try {
      content = await extractText(file);
    } catch {
      content = "";
    }
  }

  if (!name && !content) return;
  if (!content) return; // nothing readable — don't create an empty brief

  await prisma.researchBrief.create({
    data: { name: name || "Research brief", content },
  });
  revalidatePath("/research");
}

export async function deleteBrief(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.researchBrief.delete({ where: { id } });
  revalidatePath("/research");
}

// The button: send the agents to research against a brief, results to the inbox.
export async function runBrief(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const brief = await prisma.researchBrief.findUnique({ where: { id } });
  if (!brief) return;

  await researchFromBrief(brief.name, brief.content);
  await prisma.researchBrief.update({
    where: { id },
    data: { lastRunAt: new Date() },
  });
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
