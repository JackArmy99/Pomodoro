"use server";

import { revalidatePath } from "next/cache";
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
    },
  });

  revalidatePath("/opportunities");
  revalidatePath("/");
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
