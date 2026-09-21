"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  enqueueVideo,
  enqueueDocument,
  enqueuePage,
  requeueSource,
  cancelJob,
  enqueueAnalysis,
  enqueuePageAssessment,
} from "@/lib/knowledge/sources";

// Submit a video for research. Returns immediately — the worker does the work,
// so the browser never waits on a multi-minute job.
export async function submitVideo(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return;

  const result = await enqueueVideo(url);
  if (!result.ok) {
    redirect(`/knowledge?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/knowledge");
  redirect(`/knowledge/${result.sourceId}`);
}

export async function retrySource(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) return;
  await requeueSource(sourceId);
  revalidatePath(`/knowledge/${sourceId}`);
  revalidatePath("/knowledge");
}

export async function cancelSourceJob(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!jobId) return;
  await cancelJob(jobId);
  revalidatePath(`/knowledge/${sourceId}`);
}

// Summarise (or re-summarise) a video whose transcript is already stored.
export async function summariseSource(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) return;
  await enqueueAnalysis(sourceId);
  revalidatePath(`/knowledge/${sourceId}`);
  revalidatePath("/knowledge");
}

// Upload a manual or other document. Import costs nothing — no model call is
// made until you ask a question or ask for the changes to be explained.
export async function submitDocument(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`/knowledge?error=${encodeURIComponent("Choose a file to upload.")}`);
  }

  const bytes = Buffer.from(await (file as File).arrayBuffer());
  const result = await enqueueDocument((file as File).name, bytes);
  if (!result.ok) {
    redirect(`/knowledge?error=${encodeURIComponent(result.error)}`);
  }

  revalidatePath("/knowledge");
  redirect(`/knowledge/${result.sourceId}`);
}

// Watch a portal page. Dry run is the default: it proves access and shows what
// it would read, without retrieving anything.
export async function submitPage(formData: FormData) {
  const url = String(formData.get("url") ?? "").trim();
  if (!url) return;
  const dryRun = String(formData.get("dryRun") ?? "") === "on";

  const result = await enqueuePage(url, { dryRun });
  if (!result.ok) {
    redirect(`/knowledge?error=${encodeURIComponent(result.error)}`);
  }
  revalidatePath("/knowledge");
  redirect(`/knowledge/${result.sourceId}`);
}

// Re-check a watched page. Unchanged pages cost nothing, so this is cheap to
// run often.
export async function recheckPage(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) return;
  const { prisma } = await import("@/lib/db");
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!source) return;
  const result = await enqueuePage(source.canonicalUrl, { dryRun: false });
  if (!result.ok) {
    redirect(`/knowledge/${sourceId}?error=${encodeURIComponent(result.error)}`);
  }
  revalidatePath(`/knowledge/${sourceId}`);
}

// Assess a stored page and put it in the research inbox. One model call, a
// fraction of a penny — a button, never automatic, so a page that is only being
// watched for changes never costs anything.
export async function assessPage(formData: FormData) {
  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) return;
  const result = await enqueuePageAssessment(sourceId);
  if (!result.ok) {
    redirect(`/knowledge/${sourceId}?error=${encodeURIComponent(result.error)}`);
  }
  revalidatePath(`/knowledge/${sourceId}`);
}

// The permission record. Ticking this is the confirmation that automated access
// is allowed under the Wolters Kluwer agreement.
export async function togglePortal(formData: FormData) {
  const on = String(formData.get("on") ?? "") === "true";
  const { setPortalEnabled } = await import("@/lib/portal/enabled");
  await setPortalEnabled(on);
  revalidatePath("/knowledge");
}
