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

// Edit a module's description — grounds how the agents map findings to it.
export async function setModuleDescription(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const description = String(formData.get("description") ?? "").trim() || null;
  await prisma.module.update({ where: { id }, data: { description } });
  revalidatePath("/modules");
  revalidatePath(`/modules/${id}`);
}

// Edit the global product-context grounding injected into every research run.
export async function setProductContext(formData: FormData) {
  const value = String(formData.get("value") ?? "").trim();
  await prisma.setting.upsert({
    where: { key: "product_context" },
    create: { key: "product_context", value },
    update: { value },
  });
  revalidatePath("/modules");
}

export async function setClientHosting(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) return;
  const hosting = String(formData.get("hosting") ?? "").trim() || null;

  await prisma.client.update({ where: { id: clientId }, data: { hosting } });

  revalidatePath(`/clients/${clientId}`);
}
