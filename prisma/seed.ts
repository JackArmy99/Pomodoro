import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { colorFor } from "./palette.mjs";

const prisma = new PrismaClient();

type Data = {
  modules: string[];
  order: string[];
  clients: Record<
    string,
    { hosting: string | null; inUse: string[]; licensed: string[] }
  >;
};

function loadData(): Data {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(
    readFileSync(join(here, "client-modules.json"), "utf8"),
  ) as Data;
}

async function main() {
  const data = loadData();

  // Clean slate so re-seeding is predictable.
  await prisma.agentRun.deleteMany();
  await prisma.findingModule.deleteMany();
  await prisma.finding.deleteMany();
  await prisma.source.deleteMany();
  await prisma.researchBrief.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.clientModule.deleteMany();
  await prisma.task.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.briefClient.deleteMany();
  await prisma.brief.deleteMany();
  await prisma.person.deleteMany();
  await prisma.module.deleteMany();
  await prisma.client.deleteMany();

  // Module catalogue.
  const moduleId: Record<string, string> = {};
  for (const name of data.modules) {
    const m = await prisma.module.create({ data: { name } });
    moduleId[name] = m.id;
  }

  // Clients with hosting + module mapping (in_use vs licensed).
  let i = 0;
  for (const name of data.order) {
    const c = data.clients[name];
    const inUse = new Set(c.inUse);
    const all = new Set([...c.inUse, ...c.licensed]);

    await prisma.client.create({
      data: {
        name,
        type: "active",
        color: colorFor(i),
        hosting: c.hosting,
        modules: {
          create: Array.from(all).map((mod) => ({
            moduleId: moduleId[mod],
            status: inUse.has(mod) ? "in_use" : "licensed",
          })),
        },
      },
    });
    i++;
  }

  // Two starter Finder agents, pre-briefed.
  await prisma.agent.create({
    data: {
      name: "EPM Market & Vendor News",
      mission: "Latest CCH Tagetik and EPM market developments",
      archetype: "finder",
      briefing:
        "Track CCH Tagetik and the wider EPM market. Prioritise product " +
        "releases, new modules, pricing changes, end-of-support notices and " +
        "major regulatory changes (CSRD/ESRS, IFRS) that affect finance teams. " +
        "Ignore generic marketing and event listings.",
    },
  });
  await prisma.agent.create({
    data: {
      name: "Competitor Scanner",
      mission: "Moves by OneStream, Anaplan, Oracle/SAP EPM, Pigment",
      archetype: "finder",
      briefing:
        "Follow EPM competitors (OneStream, Anaplan, Oracle EPM, SAP, Pigment, " +
        "Board). Surface launches, acquisitions, notable customer wins and " +
        "positioning changes that could affect our clients or create openings.",
    },
  });

  console.log(
    `Seeded ${data.order.length} clients, ${data.modules.length} modules, 2 agents.`,
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
