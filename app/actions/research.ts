"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { processFinding, deepenFinding } from "@/lib/research/fetch";
import { getYouTubeTranscript } from "@/lib/research/youtube";

// ---- Manual quick-adds to the inbox --------------------------------------

// Paste bridge — for login-gated content you copy in yourself.
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
  await processFinding(finding.id);
  revalidatePath("/research");
}

// Ingest a YouTube video via its captions.
export async function ingestVideo(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return;
  const existing = await prisma.finding.findUnique({ where: { externalId: url } });
  if (existing) return;

  const result = await getYouTubeTranscript(url);
  if (!result) {
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

// ---- Triage --------------------------------------------------------------

export async function summariseFinding(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await processFinding(id);
  revalidatePath("/research");
  revalidatePath(`/research/${id}`);
}

export async function dismissFinding(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.finding.update({ where: { id }, data: { status: "dismissed" } });
  revalidatePath("/research");
}

// Edit a finding before approving — fix the summary, relevance, and modules.
export async function updateFinding(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const summary = String(formData.get("summary") ?? "").trim();
  const rel = String(formData.get("relevance") ?? "medium").toLowerCase();
  const relevance = rel === "high" ? "high" : rel === "low" ? "low" : "medium";
  const moduleIds = formData
    .getAll("moduleIds")
    .map((v) => String(v))
    .filter(Boolean);

  await prisma.$transaction([
    prisma.finding.update({
      where: { id },
      data: { summary, relevance },
    }),
    prisma.findingModule.deleteMany({ where: { findingId: id } }),
    ...moduleIds.map((moduleId) =>
      prisma.findingModule.create({ data: { findingId: id, moduleId } }),
    ),
  ]);

  revalidatePath("/research");
  revalidatePath(`/research/${id}`);
}

// Dig deeper — send the agent back to research the topic more, optionally
// steered by a note, and enrich this same finding's summary in place.
export async function digDeeper(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const note = String(formData.get("note") ?? "").trim();
  await deepenFinding(id, note);
  revalidatePath("/research");
  revalidatePath(`/research/${id}`);
}

// Approve → create a Brief (the intel record) and fan out to the chosen
// clients: one Opportunity/Task/Brief-link each. `clientIds` are the ticked
// clients; `type_<clientId>` selects the item type (defaults to opportunity).
export async function finalizeApprove(formData: FormData) {
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

  const clientIds = formData
    .getAll("clientIds")
    .map((v) => String(v))
    .filter(Boolean);

  for (const clientId of clientIds) {
    const type = String(formData.get(`type_${clientId}`) ?? "opportunity");

    // Always link the client to the brief (the intel record).
    await prisma.briefClient
      .create({ data: { briefId: brief.id, clientId } })
      .catch(() => {});

    if (type === "opportunity") {
      await prisma.opportunity.create({
        data: {
          title: finding.title,
          description: finding.summary,
          clientId,
          stage: "open",
          originBriefId: brief.id,
        },
      });
    } else if (type === "task") {
      await prisma.task.create({
        data: {
          title: finding.title,
          notes: finding.summary,
          clientId,
          urgency: finding.relevance === "high" ? "high" : "normal",
        },
      });
    }
    // type === "brief" → the BriefClient link above is enough.
  }

  await prisma.finding.update({
    where: { id },
    data: { status: "approved", briefId: brief.id },
  });

  revalidatePath("/research");
  revalidatePath("/briefs");
  revalidatePath("/opportunities");
  revalidatePath("/");
  redirect("/research");
}
