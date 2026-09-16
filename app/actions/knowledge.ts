"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  enqueueVideo,
  requeueSource,
  cancelJob,
  enqueueAnalysis,
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
