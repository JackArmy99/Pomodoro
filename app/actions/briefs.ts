"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseDate } from "@/lib/format";

export async function createBrief(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const summary = String(formData.get("summary") ?? "").trim();
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim() || null;
  const sourceType = String(formData.get("sourceType") ?? "manual");
  const publishedAt = parseDate(formData.get("publishedAt"));
  const clientIds = formData
    .getAll("clientIds")
    .map((v) => String(v))
    .filter(Boolean);

  await prisma.brief.create({
    data: {
      title,
      summary,
      sourceUrl,
      sourceType,
      publishedAt,
      clients: {
        create: clientIds.map((clientId) => ({ clientId })),
      },
    },
  });

  revalidatePath("/briefs");
  revalidatePath("/");
}

export async function deleteBrief(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.brief.delete({ where: { id } });

  revalidatePath("/briefs");
  revalidatePath("/");
}
