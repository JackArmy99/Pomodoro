"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseDate, parseInt0 } from "@/lib/format";

export async function createOpportunity(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const description = String(formData.get("description") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim() || null;
  const stage = String(formData.get("stage") ?? "open");
  const value = parseInt0(formData.get("value"));
  const likelihood = parseInt0(formData.get("likelihood"));
  const nextStep = String(formData.get("nextStep") ?? "").trim() || null;
  const deadline = parseDate(formData.get("deadline"));
  const originBriefId =
    String(formData.get("originBriefId") ?? "").trim() || null;
  const categoryId = String(formData.get("categoryId") ?? "").trim() || null;

  await prisma.opportunity.create({
    data: {
      title,
      description,
      clientId,
      stage,
      value,
      likelihood,
      nextStep,
      deadline,
      originBriefId,
      categoryId,
    },
  });

  revalidatePath("/opportunities");
  revalidatePath("/");
}

// One-click "create opportunity" from a licensed-but-unused module or from a
// brief's affected-clients list. Title is built from context; opens the
// pipeline so it can be refined.
export async function createOpportunityQuick(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!clientId || !title) return;

  const description = String(formData.get("description") ?? "").trim();
  const originBriefId =
    String(formData.get("originBriefId") ?? "").trim() || null;

  await prisma.opportunity.create({
    data: { title, description, clientId, stage: "open", originBriefId },
  });

  revalidatePath("/opportunities");
  revalidatePath("/");
  revalidatePath(`/clients/${clientId}`);
  redirect("/opportunities");
}

// Move an opportunity along the pipeline (used by the stage buttons).
export async function setOpportunityStage(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const stage = String(formData.get("stage") ?? "");
  if (!id || !stage) return;

  await prisma.opportunity.update({
    where: { id },
    data: { stage },
  });

  revalidatePath("/opportunities");
  revalidatePath("/");
}

export async function deleteOpportunity(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.opportunity.delete({ where: { id } });

  revalidatePath("/opportunities");
  revalidatePath("/");
}
