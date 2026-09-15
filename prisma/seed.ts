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

// Grounding + starter briefings (edit later in the app). Kept in sync with the
// add_grounding_and_provenance migration, which seeds the same for existing DBs.
const PRODUCT_CONTEXT =
  "CCH Tagetik is Wolters Kluwer's Corporate Performance Management (CPM/EPM) " +
  "platform for the office of the CFO: financial consolidation, statutory and " +
  "management close, budgeting/planning/forecasting, regulatory and disclosure " +
  "reporting, tax (including global minimum tax / Pillar Two), and ESG/CSRD " +
  "sustainability reporting. We (Swap Support) are a small consultancy that " +
  "implements and supports CCH Tagetik for client companies. Relevant " +
  "intelligence is anything that creates advisory or configuration work for our " +
  "clients: changes to financial-reporting standards (IFRS/IASB, EFRAG EU " +
  "endorsement, Dutch GAAP/RJ), insurance regulation (Solvency II / EIOPA), " +
  "global minimum tax (OECD Pillar Two, EU), and sustainability reporting " +
  "(CSRD/ESRS); plus EPM market and competitor moves (OneStream, Anaplan, " +
  "Oracle, SAP, Board, Workday Adaptive) and product/automation developments " +
  "that touch what the modules do. Ignore generic AI-market hype with no EPM or " +
  "finance-reporting angle. Map each item to the specific module(s) it affects; " +
  "a genuinely general item with no module is fine.";

const REGULATION_BRIEFING =
  "Monitor official financial-reporting and regulatory bodies for changes that " +
  "create configuration or advisory work for CCH Tagetik clients. Domains: " +
  "IFRS/IASB and EFRAG EU endorsement (IFRS 18/16/19, IFRIC, Dutch GAAP/RJ); " +
  "OECD Pillar Two global minimum tax and EU implementation; Solvency II / " +
  "EIOPA insurance reporting (QRT and XBRL taxonomy); CSRD/ESRS sustainability " +
  "(EFRAG, European Commission, ESMA). For each item capture the issuing body, " +
  "the source URL, and any effective or deadline date. HIT: a new or amended " +
  "standard, an endorsement-status change, a published directive or delegated " +
  "regulation, a taxonomy or QRT change, a national transposition affecting " +
  "clients. NOISE: Big Four explainer restatements of already-known facts, " +
  "marketing, webinars, political commentary. Map to the affected module(s); if " +
  "none clearly applies, leave modules empty as general regulatory intel. Never " +
  "assert a specific date or figure without a source URL.";

const MODULES_BRIEFING =
  "Scan the wider market for developments that create advisory or upsell " +
  "opportunities tied to what our CCH Tagetik modules do (see the product " +
  "context and module descriptions provided). Include EPM product releases and " +
  "roadmaps, competitor moves (OneStream, Anaplan, Oracle, SAP, Board, Workday " +
  "Adaptive), and automation/AI in financial close, consolidation, planning, " +
  "disclosure and ESG. For each item identify which module(s) it relates to and " +
  "why it is an opportunity for clients holding that module. HIT: something a " +
  "client could act on or we could pitch. NOISE: generic AI hype with no " +
  "finance or EPM angle. If nothing maps to a module, keep it only if it is " +
  "clearly EPM-relevant.";

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
  const moduleDescriptions: Record<string, string> = {
    "Analytical Information Hub":
      "Data warehouse and analytics layer that aggregates financial and operational data for reporting and analysis.",
    "Budgeting & Planning":
      "Driver-based budgeting, forecasting and planning across the enterprise.",
    "Collaborative Office":
      "Microsoft Office (Word, Excel, PowerPoint) integration for narrative reporting, disclosure and board books.",
    Consolidation:
      "Statutory and management financial consolidation: group close, intercompany, ownership and currency translation.",
    ETL: "Extract-transform-load data integration from source systems into Tagetik.",
    "Financial Close & Fast Close":
      "Orchestrated period-end close, reconciliations and task management to shorten the close.",
    Foundation:
      "The core Tagetik platform (data model, security, workflow) that the other modules build on.",
    "IFRS 16":
      "Lease accounting under IFRS 16: right-of-use assets, lease liabilities and remeasurement.",
    "MS Dynamics AX":
      "Prebuilt connector and integration to Microsoft Dynamics AX ERP.",
    "Machine Learning AA":
      "Predictive and advanced analytics: machine-learning forecasting and anomaly detection.",
    PowerPoint:
      "PowerPoint integration for automated, data-linked presentation reporting.",
    SmartInsight:
      "AI and natural-language assistant for querying data and generating narrative insight.",
    "Solvency II":
      "Insurance regulatory reporting under Solvency II: QRTs, XBRL taxonomy and SFCR/RSR.",
  };
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
