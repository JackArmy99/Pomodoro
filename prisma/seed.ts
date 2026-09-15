import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { colorFor } from "./palette.mjs";
import {
  PRODUCT_CONTEXT,
  REGULATION_BRIEFING,
  MODULES_BRIEFING,
  MODULE_DESCRIPTIONS,
} from "./grounding.mjs";

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

  // Module catalogue, with starter descriptions that ground the agents'
  // module mapping (edit later in the app on /modules).
  const moduleDescriptions = MODULE_DESCRIPTIONS as Record<string, string>;
  const moduleId: Record<string, string> = {};
  for (const name of data.modules) {
    const m = await prisma.module.create({
      data: { name, description: moduleDescriptions[name] ?? null },
    });
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

  // Editable product-context grounding, injected into every research run.
  await prisma.setting.upsert({
    where: { key: "product_context" },
    create: { key: "product_context", value: PRODUCT_CONTEXT },
    update: {},
  });

  // Two starter agents (see plan): a Regulation & Standards beat with one
  // pinned search per domain, and a broad Module Opportunities beat.
  await prisma.agent.create({
    data: {
      id: "agent_regulation",
      name: "Regulation & Standards",
      mission:
        "Watch official standards and regulatory bodies for changes that create client work.",
      archetype: "finder",
      maxItems: 8,
      allowedDomains:
        "ifrs.org, efrag.org, eur-lex.europa.eu, iasplus.com, rjnet.nl, oecd.org, taxation-customs.ec.europa.eu, finance.ec.europa.eu, consilium.europa.eu, eiopa.europa.eu, dnb.nl, esma.europa.eu",
      briefing: REGULATION_BRIEFING,
      sources: {
        create: [
          { id: "src_reg_ifrs", name: "IFRS & Consolidation", type: "web", query: "IFRS 18 IFRS 16 IFRS 19 IASB EFRAG endorsement IFRIC financial statement presentation" },
          { id: "src_reg_pillar2", name: "Pillar Two / Global Minimum Tax", type: "web", query: "OECD Pillar Two global minimum tax GloBE administrative guidance EU minimum tax DAC9" },
          { id: "src_reg_solvency", name: "Solvency II", type: "web", query: "Solvency II review EIOPA reporting taxonomy QRT ITS delegated regulation" },
          { id: "src_reg_csrd", name: "CSRD / ESRS", type: "web", query: "CSRD ESRS Omnibus simplified sustainability reporting EFRAG delegated act" },
        ],
      },
    },
  });
  await prisma.agent.create({
    data: {
      id: "agent_modules",
      name: "Module Opportunities",
      mission:
        "Find market and product developments that create opportunities tied to our modules.",
      archetype: "finder",
      briefing: MODULES_BRIEFING,
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
