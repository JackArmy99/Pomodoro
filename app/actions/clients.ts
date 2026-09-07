"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

export async function createClient(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const type = String(formData.get("type") ?? "active");
  const color = String(formData.get("color") ?? "#6366f1");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  await prisma.client.create({
    data: { name, type, color, notes },
  });

  revalidatePath("/clients");
  revalidatePath("/");
}

export async function deleteClient(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.client.delete({ where: { id } });

  revalidatePath("/clients");
  revalidatePath("/");
  redirect("/clients");
}
