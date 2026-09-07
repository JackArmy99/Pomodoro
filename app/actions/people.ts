"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function createPerson(formData: FormData) {
  const initials = String(formData.get("initials") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  if (!initials || !clientId) return;

  const role = String(formData.get("role") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  await prisma.person.create({
    data: { initials, role, notes, clientId },
  });

  revalidatePath(`/clients/${clientId}`);
}

export async function deletePerson(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const clientId = String(formData.get("clientId") ?? "");
  if (!id) return;

  await prisma.person.delete({ where: { id } });

  if (clientId) revalidatePath(`/clients/${clientId}`);
}
