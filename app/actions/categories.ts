"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function createCategory(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await prisma.opportunityCategory
    .create({ data: { name } })
    .catch(() => {}); // ignore duplicates

  revalidatePath("/opportunities");
}

export async function deleteCategory(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.opportunityCategory.delete({ where: { id } });

  revalidatePath("/opportunities");
}
