"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  runFinderAgent,
  researchAdHoc,
  researchFromBrief,
  type RunTally,
} from "@/lib/research/fetch";
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
        // On an empty run, keep the diagnostic so it isn't a black box.
        message: tally.created === 0 ? tally.reason ?? null : null,
      },
    }),
    prisma.agent.update({
      where: { id: agentId },
      data: { lastRunAt: new Date() },
    }),
  ]);
}

// Record a failed run so the reason is visible in the agent's history rather
// than disappearing into the server log.
async function recordError(agentId: string, err: unknown) {
  await prisma.agentRun.create({
    data: {
      agentId,
      status: "error",
      message:
        err instanceof Error
          ? err.message.slice(0, 300)
          : String(err).slice(0, 300),
    },
  });
  await prisma.agent.update({
    where: { id: agentId },
    data: { lastRunAt: new Date() },
  });
}

// Run one agent, always leaving a run row behind (ok, nothing_new or error).
async function runOne(agent: Parameters<typeof runFinderAgent>[0]) {
  try {
    const tally = await runFinderAgent(agent);
    await recordRun(agent.id, tally);
  } catch (err) {
    await recordError(agent.id, err);
  }
}

export async function runAgent(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return;

  await runOne(agent);

  revalidatePath(`/agents/${id}`);
  revalidatePath("/agents");
  revalidatePath("/research");
}

export async function runAllAgents() {
  const agents = await prisma.agent.findMany({
    where: { active: true, archetype: "finder" },
  });
  for (const a of agents) await runOne(a);
  revalidatePath("/agents");
  revalidatePath("/research");
}

// --- Research briefs attached to an agent -------------------------------

// Attach a brief (uploaded PDF/Word, or typed text) to an agent. Every run
// researches each attached brief alongside the agent's briefing.
export async function addAgentBrief(formData: FormData) {
  const agentId = String(formData.get("agentId") ?? "");
  if (!agentId) return;

  const file = formData.get("file");
  let name = String(formData.get("name") ?? "").trim();
  let content = String(formData.get("content") ?? "").trim();

  if (file instanceof File && file.size > 0) {
    try {
      const text = await extractText(file);
      if (text) {
        content = [content, text].filter(Boolean).join("\n\n");
        if (!name) name = file.name.replace(/\.[^.]+$/, "");
      }
    } catch {
      return;
    }
  }
  if (!content) return;

  await prisma.researchBrief.create({
    data: { agentId, name: name || "Untitled brief", content },
  });
  revalidatePath(`/agents/${agentId}`);
}

export async function deleteAgentBrief(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const agentId = String(formData.get("agentId") ?? "");
  if (!id) return;
  await prisma.researchBrief.delete({ where: { id } });
  if (agentId) revalidatePath(`/agents/${agentId}`);
}

// Research a single brief now, without running the agent's whole beat.
export async function runAgentBrief(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const brief = await prisma.researchBrief.findUnique({
    where: { id },
    include: { agent: true },
  });
  if (!brief) return;

  try {
    const tally = await researchFromBrief(brief.name, brief.content, {
      agentId: brief.agentId,
      agent: brief.agent,
    });
    if (brief.agentId) await recordRun(brief.agentId, tally);
  } catch (err) {
    if (brief.agentId) await recordError(brief.agentId, err);
  }

  await prisma.researchBrief.update({
    where: { id },
    data: { lastRunAt: new Date() },
  });
  if (brief.agentId) revalidatePath(`/agents/${brief.agentId}`);
  revalidatePath("/research");
}

// One-off ad-hoc research from the overview box: a typed topic, or a
// PDF/Word/txt file whose extracted text becomes the topic.
export async function researchNow(formData: FormData) {
  let query = String(formData.get("query") ?? "").trim();

  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    try {
      const text = await extractText(file);
      if (text) query = text.slice(0, 1500);
    } catch {
      return;
    }
  }

  if (!query) return;
  await researchAdHoc(query);
  revalidatePath("/agents");
  revalidatePath("/research");
}

// Flip the cheap "Test mode" switch (Haiku + fewer searches) on or off.
export async function setTestMode(formData: FormData) {
  const on = String(formData.get("on") ?? "") === "true";
  await prisma.setting.upsert({
    where: { key: "test_mode" },
    create: { key: "test_mode", value: on ? "on" : "off" },
    update: { value: on ? "on" : "off" },
  });
  revalidatePath("/agents");
}
