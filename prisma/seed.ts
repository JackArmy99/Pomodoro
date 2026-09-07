import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Helper: a date N days from today (local midnight).
function inDays(n: number): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  // Clean slate so re-seeding is predictable.
  await prisma.task.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.briefClient.deleteMany();
  await prisma.brief.deleteMany();
  await prisma.person.deleteMany();
  await prisma.client.deleteMany();

  // Clients use CODE NAMES; people use INITIALS — safe to share.
  const falcon = await prisma.client.create({
    data: {
      name: "Falcon",
      type: "active",
      color: "#6366f1",
      notes: "CCH Tagetik CPM in production.",
      people: {
        create: [
          { initials: "P.R.", role: "FP&A lead" },
          { initials: "S.M.", role: "IT sponsor" },
        ],
      },
    },
  });

  const orion = await prisma.client.create({
    data: {
      name: "Orion",
      type: "active",
      color: "#0ea5e9",
      notes: "Consolidation + disclosure. Exploring ESG reporting.",
      people: { create: [{ initials: "D.K.", role: "Finance director" }] },
    },
  });

  const vega = await prisma.client.create({
    data: {
      name: "Vega",
      type: "prospect",
      color: "#f59e0b",
      notes: "Evaluating EPM vendors. Warm intro via conference.",
      people: { create: [{ initials: "L.T." }] },
    },
  });

  const esgBrief = await prisma.brief.create({
    data: {
      title: "CSRD Omnibus timeline update — phased ESRS simplification",
      summary:
        "Regulators confirmed a phased simplification of ESRS datapoints. Clients scoping CSRD should revisit materiality this quarter.",
      sourceType: "newsletter",
      sourceUrl: "https://example.com/csrd-omnibus-update",
      publishedAt: inDays(-5),
      clients: { create: [{ clientId: orion.id }, { clientId: falcon.id }] },
    },
  });

  await prisma.brief.create({
    data: {
      title: "CCH Tagetik 2026.1 adds AI-assisted reconciliation",
      summary:
        "New release includes AI-assisted intercompany reconciliation and a refreshed FST designer. Worth a demo for clients on older versions.",
      sourceType: "rss",
      sourceUrl: "https://example.com/tagetik-2026-1",
      publishedAt: inDays(-2),
      clients: { create: [{ clientId: falcon.id }] },
    },
  });

  await prisma.brief.create({
    data: {
      title: "Webinar: Modern consolidation close in under 5 days",
      summary:
        "Vendor webinar on a faster close. Good talking point for prospects still on spreadsheets.",
      sourceType: "video",
      sourceUrl: "https://example.com/fast-close-webinar",
      publishedAt: inDays(-1),
      clients: { create: [{ clientId: vega.id }] },
    },
  });

  // Personal tasks across the day/week/month buckets.
  await prisma.task.createMany({
    data: [
      {
        title: "Send Falcon the 2026.1 release highlights",
        urgency: "high",
        dueDate: inDays(0),
        estimateMinutes: 30,
        clientId: falcon.id,
      },
      {
        title: "Reply to Orion re: ESG scoping workshop",
        urgency: "urgent",
        dueDate: inDays(-1),
        estimateMinutes: 20,
        clientId: orion.id,
      },
      {
        title: "Draft fast-close demo offer for Vega",
        urgency: "normal",
        dueDate: inDays(3),
        estimateMinutes: 60,
        clientId: vega.id,
        bookedInTeams: true,
      },
      {
        title: "Review CSRD Omnibus impact across client base",
        urgency: "high",
        dueDate: inDays(12),
        estimateMinutes: 90,
      },
      {
        title: "Quarterly account review prep",
        urgency: "low",
        estimateMinutes: 45,
      },
    ],
  });

  await prisma.opportunity.create({
    data: {
      title: "Pitch ESG reporting module to Orion",
      description:
        "CSRD timeline update is a natural opening to propose the ESG module and a scoping workshop.",
      clientId: orion.id,
      stage: "pursuing",
      value: 45000,
      likelihood: 55,
      nextStep: "Book a scoping call with the finance director.",
      deadline: inDays(21),
      originBriefId: esgBrief.id,
    },
  });

  await prisma.opportunity.create({
    data: {
      title: "Upgrade Falcon to 2026.1",
      description:
        "Falcon is two releases behind. Position the AI reconciliation features.",
      clientId: falcon.id,
      stage: "open",
      value: 18000,
      likelihood: 40,
      nextStep: "Send release highlights.",
    },
  });

  await prisma.opportunity.create({
    data: {
      title: "Vega EPM evaluation — get shortlisted",
      description:
        "Prospect actively evaluating vendors. Offer a tailored fast-close demo.",
      clientId: vega.id,
      stage: "open",
      value: 90000,
      likelihood: 25,
      nextStep: "Follow up after the webinar with a demo offer.",
      deadline: inDays(30),
    },
  });

  console.log(
    "Seeded: 3 clients (code names), 4 people, 3 briefs, 5 tasks, 3 opportunities.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
