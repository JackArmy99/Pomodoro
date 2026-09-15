-- Domain grounding + finding provenance/deadline/verification.

-- New columns.
ALTER TABLE "Module" ADD COLUMN "description" TEXT;
ALTER TABLE "Finding" ADD COLUMN "sourceBody" TEXT;
ALTER TABLE "Finding" ADD COLUMN "effectiveDate" DATETIME;
ALTER TABLE "Finding" ADD COLUMN "verified" BOOLEAN NOT NULL DEFAULT false;

-- Back-fill starter module descriptions (only sets rows that match by name;
-- they are NULL today so nothing is overwritten). Edit later in the app.
UPDATE "Module" SET "description" = 'Data warehouse and analytics layer that aggregates financial and operational data for reporting and analysis.' WHERE "name" = 'Analytical Information Hub' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'Driver-based budgeting, forecasting and planning across the enterprise.' WHERE "name" = 'Budgeting & Planning' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'Microsoft Office (Word, Excel, PowerPoint) integration for narrative reporting, disclosure and board books.' WHERE "name" = 'Collaborative Office' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'Statutory and management financial consolidation: group close, intercompany, ownership and currency translation.' WHERE "name" = 'Consolidation' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'Extract-transform-load data integration from source systems into Tagetik.' WHERE "name" = 'ETL' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'Orchestrated period-end close, reconciliations and task management to shorten the close.' WHERE "name" = 'Financial Close & Fast Close' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'The core Tagetik platform (data model, security, workflow) that the other modules build on.' WHERE "name" = 'Foundation' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'Lease accounting under IFRS 16: right-of-use assets, lease liabilities and remeasurement.' WHERE "name" = 'IFRS 16' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'Prebuilt connector and integration to Microsoft Dynamics AX ERP.' WHERE "name" = 'MS Dynamics AX' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'Predictive and advanced analytics: machine-learning forecasting and anomaly detection.' WHERE "name" = 'Machine Learning AA' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'PowerPoint integration for automated, data-linked presentation reporting.' WHERE "name" = 'PowerPoint' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'AI and natural-language assistant for querying data and generating narrative insight.' WHERE "name" = 'SmartInsight' AND "description" IS NULL;
UPDATE "Module" SET "description" = 'Insurance regulatory reporting under Solvency II: QRTs, XBRL taxonomy and SFCR/RSR.' WHERE "name" = 'Solvency II' AND "description" IS NULL;

-- Seed the editable product-context grounding (skip if it already exists).
INSERT OR IGNORE INTO "Setting" ("key", "value") VALUES (
  'product_context',
  'CCH Tagetik is Wolters Kluwer''s Corporate Performance Management (CPM/EPM) platform for the office of the CFO: financial consolidation, statutory and management close, budgeting/planning/forecasting, regulatory and disclosure reporting, tax (including global minimum tax / Pillar Two), and ESG/CSRD sustainability reporting. We (Swap Support) are a small consultancy that implements and supports CCH Tagetik for client companies. Relevant intelligence is anything that creates advisory or configuration work for our clients: changes to financial-reporting standards (IFRS/IASB, EFRAG EU endorsement, Dutch GAAP/RJ), insurance regulation (Solvency II / EIOPA), global minimum tax (OECD Pillar Two, EU), and sustainability reporting (CSRD/ESRS); plus EPM market and competitor moves (OneStream, Anaplan, Oracle, SAP, Board, Workday Adaptive) and product/automation developments that touch what the modules do. Ignore generic AI-market hype with no EPM or finance-reporting angle. Map each item to the specific module(s) it affects; a genuinely general item with no module is fine.'
);

-- Two starter agents (idempotent). Leave any existing agent untouched.
INSERT OR IGNORE INTO "Agent" ("id", "name", "mission", "archetype", "briefing", "active", "allowedDomains", "maxItems", "lookbackDays")
VALUES (
  'agent_regulation',
  'Regulation & Standards',
  'Watch official standards and regulatory bodies for changes that create client work.',
  'finder',
  'Monitor official financial-reporting and regulatory bodies for changes that create configuration or advisory work for CCH Tagetik clients. Domains: IFRS/IASB and EFRAG EU endorsement (IFRS 18/16/19, IFRIC, Dutch GAAP/RJ); OECD Pillar Two global minimum tax and EU implementation; Solvency II / EIOPA insurance reporting (QRT and XBRL taxonomy); CSRD/ESRS sustainability (EFRAG, European Commission, ESMA). For each item capture the issuing body, the source URL, and any effective or deadline date. HIT: a new or amended standard, an endorsement-status change, a published directive or delegated regulation, a taxonomy or QRT change, a national transposition affecting clients. NOISE: Big Four explainer restatements of already-known facts, marketing, webinars, political commentary. Map to the affected module(s); if none clearly applies, leave modules empty as general regulatory intel. Never assert a specific date or figure without a source URL.',
  true,
  'ifrs.org, efrag.org, eur-lex.europa.eu, iasplus.com, rjnet.nl, oecd.org, taxation-customs.ec.europa.eu, finance.ec.europa.eu, consilium.europa.eu, eiopa.europa.eu, dnb.nl, esma.europa.eu',
  8,
  30
);
INSERT OR IGNORE INTO "Agent" ("id", "name", "mission", "archetype", "briefing", "active", "maxItems", "lookbackDays")
VALUES (
  'agent_modules',
  'Module Opportunities',
  'Find market and product developments that create opportunities tied to our modules.',
  'finder',
  'Scan the wider market for developments that create advisory or upsell opportunities tied to what our CCH Tagetik modules do (see the product context and module descriptions provided). Include EPM product releases and roadmaps, competitor moves (OneStream, Anaplan, Oracle, SAP, Board, Workday Adaptive), and automation/AI in financial close, consolidation, planning, disclosure and ESG. For each item identify which module(s) it relates to and why it is an opportunity for clients holding that module. HIT: something a client could act on or we could pitch. NOISE: generic AI hype with no finance or EPM angle. If nothing maps to a module, keep it only if it is clearly EPM-relevant.',
  true,
  6,
  30
);

-- Regulation agent pinned sources, one focused search per domain.
INSERT OR IGNORE INTO "Source" ("id", "name", "type", "query", "active", "agentId") VALUES
  ('src_reg_ifrs', 'IFRS & Consolidation', 'web', 'IFRS 18 IFRS 16 IFRS 19 IASB EFRAG endorsement IFRIC financial statement presentation', true, 'agent_regulation'),
  ('src_reg_pillar2', 'Pillar Two / Global Minimum Tax', 'web', 'OECD Pillar Two global minimum tax GloBE administrative guidance EU minimum tax DAC9', true, 'agent_regulation'),
  ('src_reg_solvency', 'Solvency II', 'web', 'Solvency II review EIOPA reporting taxonomy QRT ITS delegated regulation', true, 'agent_regulation'),
  ('src_reg_csrd', 'CSRD / ESRS', 'web', 'CSRD ESRS Omnibus simplified sustainability reporting EFRAG delegated act', true, 'agent_regulation');
