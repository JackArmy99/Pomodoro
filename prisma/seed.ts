import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Start from a clean slate so re-seeding is predictable.
  await prisma.opportunity.deleteMany();
  await prisma.briefClient.deleteMany();
  await prisma.brief.deleteMany();
  await prisma.client.deleteMany();

  const acme = await prisma.client.create({
    data: {
      name: "Acme Manufacturing",
      type: "active",
      color: "#6366f1",
      notes: "CCH Tagetik CPM in production. Key contact: Priya (FP&A lead).",
    },
  });

  const northwind = await prisma.client.create({
    data: {
      name: "Northwind Group",
      type: "active",
      color: "#0ea5e9",
      notes: "Consolidation + disclosure. Exploring ESG reporting.",
    },
  });

  const globex = await prisma.client.create({
    data: {
      name: "Globex Retail",
      type: "prospect",
      color: "#f59e0b",
      notes: "Evaluating EPM vendors. Warm intro via conference.",
    },
  });

  const esgBrief = await prisma.brief.create({
    data: {
      title: "CSRD Omnibus timeline update — phased ESRS simplification",
      summary:
        "Regulators confirmed a phased simplification of ESRS datapoints. Clients already scoping CSRD should revisit materiality assessments this quarter.",
      sourceType: "newsletter",
      sourceUrl: "https://example.com/csrd-omnibus-update",
      publishedAt: new Date("2026-08-20"),
      clients: {
        create: [{ clientId: northwind.id }, { clientId: acme.id }],
      },
    },
  });

  await prisma.brief.create({
    data: {
      title: "CCH Tagetik 2026.1 adds AI-assisted reconciliation",
      summary:
        "New release includes AI-assisted intercompany reconciliation and a refreshed FST designer. Worth a demo for clients on older versions.",
      sourceType: "rss",
      sourceUrl: "https://example.com/tagetik-2026-1",
      publishedAt: new Date("2026-08-28"),
      clients: { create: [{ clientId: acme.id }] },
    },
  });

  await prisma.brief.create({
    data: {
      title: "Webinar: Modern consolidation close in under 5 days",
      summary:
        "Vendor webinar walking through a faster close. Good talking point for prospects still on spreadsheets.",
      sourceType: "video",
      sourceUrl: "https://example.com/fast-close-webinar",
      publishedAt: new Date("2026-09-01"),
      clients: { create: [{ clientId: globex.id }] },
    },
  });

  await prisma.opportunity.create({
    data: {
      title: "Pitch ESG reporting module to Northwind",
      description:
        "CSRD timeline update is a natural opening to propose the ESG module and a scoping workshop.",
      clientId: northwind.id,
      stage: "pursuing",
      value: 45000,
      likelihood: 55,
      nextStep: "Book a scoping call with the finance director.",
      deadline: new Date("2026-09-30"),
      originBriefId: esgBrief.id,
    },
  });

  await prisma.opportunity.create({
    data: {
      title: "Upgrade Acme to 2026.1",
      description:
        "Acme is two releases behind. Position the AI reconciliation features.",
      clientId: acme.id,
      stage: "open",
      value: 18000,
      likelihood: 40,
      nextStep: "Send release highlights to Priya.",
    },
  });

  await prisma.opportunity.create({
    data: {
      title: "Globex EPM evaluation — get shortlisted",
      description:
        "Prospect actively evaluating vendors. Offer a tailored fast-close demo.",
      clientId: globex.id,
      stage: "open",
      value: 90000,
      likelihood: 25,
      nextStep: "Follow up after the webinar with a demo offer.",
      deadline: new Date("2026-10-15"),
    },
  });

  console.log("Seeded: 3 clients, 3 briefs, 3 opportunities.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
