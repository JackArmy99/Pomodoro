"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { parseDate, parseInt0 } from "@/lib/format";

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const notes = String(formData.get("notes") ?? "").trim() || null;
  const clientId = String(formData.get("clientId") ?? "").trim() || null;
  const urgency = String(formData.get("urgency") ?? "normal");
  const dueDate = parseDate(formData.get("dueDate"));
  const estimateMinutes = parseInt0(formData.get("estimateMinutes"));

  await prisma.task.create({
    data: { title, notes, clientId, urgency, dueDate, estimateMinutes },
  });

  revalidatePath("/");
}

export async function toggleTaskDone(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return;

  await prisma.task.update({
    where: { id },
    data: { done: !task.done },
  });

  revalidatePath("/");
}

export async function toggleBookedInTeams(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return;

  await prisma.task.update({
    where: { id },
    data: { bookedInTeams: !task.bookedInTeams },
  });

  revalidatePath("/");
}

export async function deleteTask(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.task.delete({ where: { id } });

  revalidatePath("/");
}
