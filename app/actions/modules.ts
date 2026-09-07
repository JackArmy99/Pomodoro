"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

// Set a client's relationship to a module: "in_use", "licensed", or "none"
// (which removes it). This powers the + / − editing on a client page.
export async function setClientModule(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  const moduleId = String(formData.get("moduleId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!clientId || !moduleId) return;

  if (status === "none") {
    await prisma.clientModule
      .delete({ where: { clientId_moduleId: { clientId, moduleId } } })
      .catch(() => {}); // already absent — fine
  } else if (status === "in_use" || status === "licensed") {
    await prisma.clientModule.upsert({
      where: { clientId_moduleId: { clientId, moduleId } },
      create: { clientId, moduleId, status },
      update: { status },
    });
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/modules");
  revalidatePath(`/modules/${moduleId}`);
}

export async function createModule(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await prisma.module
    .create({ data: { name } })
    .catch(() => {}); // ignore duplicate names

  revalidatePath("/modules");
  const clientId = String(formData.get("clientId") ?? "");
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

export async function setClientHosting(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) return;
  const hosting = String(formData.get("hosting") ?? "").trim() || null;

  await prisma.client.update({ where: { id: clientId }, data: { hosting } });

  revalidatePath(`/clients/${clientId}`);
}
