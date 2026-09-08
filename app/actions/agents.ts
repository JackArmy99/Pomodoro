"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { runFinderAgent, researchAdHoc, type RunTally } from "@/lib/research/fetch";
import { extractText } from "@/lib/research/extract";

export async function createAgent(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const mission = String(formData.get("mission") ?? "").trim();
  const archetype = String(formData.get("archetype") ?? "finder");

  const agent = await prisma.agent.create({
    data: { name, mission, archetype },
  });
  revalidatePath("/agents");
  redirect(`/agents/${agent.id}`);
}

export async function updateAgent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const data: Record<string, unknown> = {};
  const name = String(formData.get("name") ?? "").trim();
  if (name) data.name = name;
  if (formData.has("mission"))
    data.mission = String(formData.get("mission") ?? "").trim();
  if (formData.has("briefing"))
    data.briefing = String(formData.get("briefing") ?? "").trim();
  if (formData.has("allowedDomains"))
    data.allowedDomains =
      String(formData.get("allowedDomains") ?? "").trim() || null;
  if (formData.has("blockedDomains"))
    data.blockedDomains =
      String(formData.get("blockedDomains") ?? "").trim() || null;
  if (formData.has("maxItems")) {
    const n = Number.parseInt(String(formData.get("maxItems")), 10);
    if (!Number.isNaN(n)) data.maxItems = Math.min(Math.max(n, 1), 20);
  }
  if (formData.has("lookbackDays")) {
    const n = Number.parseInt(String(formData.get("lookbackDays")), 10);
    if (!Number.isNaN(n)) data.lookbackDays = Math.min(Math.max(n, 1), 365);
  }

  await prisma.agent.update({ where: { id }, data });
  revalidatePath(`/agents/${id}`);
  revalidatePath("/agents");
}

// Upload a PDF/Word brief and append its text into the agent's briefing.
export async function appendBriefingFromFile(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const file = formData.get("file");
  if (!id || !(file instanceof File) || file.size === 0) return;

  let text = "";
  try {
    text = await extractText(file);
  } catch {
    return;
  }
  if (!text) return;

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return;
  const briefing = [agent.briefing, text].filter((s) => s && s.trim()).join("\n\n");

  await prisma.agent.update({ where: { id }, data: { briefing } });
  revalidatePath(`/agents/${id}`);
}

export async function deleteAgent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.agent.delete({ where: { id } });
  revalidatePath("/agents");
  redirect("/agents");
}

// Pin a source (web topic or RSS feed) to an agent.
export async function addAgentSource(formData: FormData) {
  const agentId = String(formData.get("agentId") ?? "");
  const type = String(formData.get("type") ?? "web");
  const name = String(formData.get("name") ?? "").trim();
  if (!agentId || !name) return;

  if (type === "rss") {
    const url = String(formData.get("url") ?? "").trim();
    if (!url) return;
    await prisma.source.create({ data: { agentId, type: "rss", name, url } });
  } else {
    const query = String(formData.get("query") ?? "").trim();
    if (!query) return;
    await prisma.source.create({ data: { agentId, type: "web", name, query } });
  }
  revalidatePath(`/agents/${agentId}`);
}

export async function deleteAgentSource(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const agentId = String(formData.get("agentId") ?? "");
  if (!id) return;
  await prisma.source.delete({ where: { id } });
  if (agentId) revalidatePath(`/agents/${agentId}`);
}

// Record an AgentRun from a tally.
async function recordRun(agentId: string, tally: RunTally) {
  await prisma.$transaction([
    prisma.agentRun.create({
      data: {
        agentId,
        foundCount: tally.created,
        highCount: tally.high,
        medCount: tally.med,
        lowCount: tally.low,
        estCostCents: tally.costCents,
        status: tally.created === 0 ? "nothing_new" : "ok",
      },
    }),
    prisma.agent.update({
      where: { id: agentId },
      data: { lastRunAt: new Date() },
    }),
  ]);
}

export async function runAgent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return;

  try {
    const tally = await runFinderAgent(agent);
    await recordRun(id, tally);
  } catch (err) {
    await prisma.agentRun.create({
      data: {
        agentId: id,
        status: "error",
        message: err instanceof Error ? err.message.slice(0, 300) : "error",
      },
    });
    await prisma.agent.update({
      where: { id },
      data: { lastRunAt: new Date() },
    });
  }

  revalidatePath(`/agents/${id}`);
  revalidatePath("/agents");
  revalidatePath("/research");
}

export async function runAllAgents() {
  const agents = await prisma.agent.findMany({
    where: { active: true, archetype: "finder" },
  });
  for (const a of agents) {
    try {
      const tally = await runFinderAgent(a);
      await recordRun(a.id, tally);
    } catch {
      /* logged per-agent below in single runs; skip here */
    }
  }
  revalidatePath("/agents");
  revalidatePath("/research");
}

// One-off ad-hoc research from the overview box.
export async function researchNow(formData: FormData) {
  const query = String(formData.get("query") ?? "").trim();
  if (!query) return;
  await researchAdHoc(query);
  revalidatePath("/agents");
  revalidatePath("/research");
}
