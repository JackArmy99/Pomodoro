// Editable domain grounding — the single source for the seed (fresh databases)
// and scripts/refresh-grounding.mjs (existing databases). These are STARTING
// DRAFTS: refine them in the app on /modules. The Module Opportunities agent
// reads each module's "Opportunity signals:" clause to spot where work exists.

export const PRODUCT_CONTEXT =
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

export const REGULATION_BRIEFING =
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

export const MODULES_BRIEFING =
  "Scan the wider market for developments that create advisory or upsell " +
  "opportunities for our CCH Tagetik clients, tied to what our modules do. Use " +
  "each module's description AND its 'Opportunity signals:' clause to decide " +
  "relevance: when an item matches a module's signals, map it to that module " +
  "and explain the opportunity — what work it would create and for which kind " +
  "of client. Cover EPM product releases and roadmaps, competitor moves " +
  "(OneStream, Anaplan, Oracle, SAP, Board, Workday Adaptive), automation/AI in " +
  "close, consolidation, planning, disclosure and ESG, and finance-" +
  "transformation trends (ERP migrations, cloud moves, shared-service changes). " +
  "HIT: something a client could act on or we could pitch. NOISE: generic AI " +
  "hype with no finance or EPM angle. If nothing maps to a module, keep it only " +
  "if it is clearly EPM-relevant.";

// name → "what it does. Opportunity signals: …". The signals are the levers the
// Module Opportunities agent looks for; correct them with your real triggers.
export const MODULE_DESCRIPTIONS = {
  "Analytical Information Hub":
    "Data warehouse and analytics layer aggregating financial and operational data for reporting and analytics. Opportunity signals: new data sources or ERPs to integrate, demand for self-service analytics/dashboards, performance problems on large data volumes, replacing spreadsheet-based reporting.",
  "Budgeting & Planning":
    "Driver-based budgeting, forecasting and planning across the enterprise. Opportunity signals: move to rolling forecasts or scenario planning, spreadsheet-heavy planning to replace, new business units or drivers, workforce/capex planning needs.",
  "Collaborative Office":
    "Microsoft Office (Word/Excel/PowerPoint) integration for narrative reporting, disclosure and board books. Opportunity signals: new disclosure requirements (IFRS 18 MPMs, ESRS narratives), manual annual-report assembly, version-control/audit pain, iXBRL/ESEF tagging needs.",
  Consolidation:
    "Statutory and management consolidation: group close, intercompany, ownership, currency. Opportunity signals: M&A or new group structures, new/changed standards affecting the P&L or balance sheet (e.g. IFRS 18), multi-GAAP reporting, manual consolidation to automate, long close cycles.",
  ETL:
    "Extract-transform-load integration from source systems into Tagetik. Opportunity signals: ERP migration (e.g. S/4HANA), new source systems, brittle or manual data loads, data-quality and reconciliation issues.",
  "Financial Close & Fast Close":
    "Orchestrated period-end close, reconciliations and task management. Opportunity signals: long or manual closes, audit findings on controls, reconciliation backlogs, drive to shorten the close, SOX/control automation.",
  Foundation:
    "Core Tagetik platform (data model, security, workflow) the other modules build on. Opportunity signals: version upgrades or cloud (SaaS) migration, security/role redesign, workflow redesign, platform health checks, re-implementations.",
  "IFRS 16":
    "Lease accounting under IFRS 16 (right-of-use assets, lease liabilities, remeasurement). Opportunity signals: growing lease portfolios, high remeasurement/modification volume, audit issues, any IFRS 16 amendment, new entities adopting.",
  "MS Dynamics AX":
    "Connector/integration to Microsoft Dynamics AX ERP. Opportunity signals: Dynamics upgrades or migrations, integration breakages, new entities onboarding to Dynamics.",
  "Machine Learning AA":
    "Predictive and advanced analytics (ML forecasting, anomaly detection). Opportunity signals: demand for predictive forecasting, anomaly or fraud detection, large historical datasets, manual forecast-adjustment pain.",
  PowerPoint:
    "PowerPoint integration for automated, data-linked presentation reporting. Opportunity signals: manual board/exec deck preparation, recurring management reporting, version-control errors in decks.",
  SmartInsight:
    "AI/NLP assistant for querying data and generating narrative insight. Opportunity signals: demand for self-service Q&A on financial data, narrative/commentary generation, adoption or enablement projects.",
  "Solvency II":
    "Insurance regulatory reporting under Solvency II (QRTs, XBRL taxonomy, SFCR/RSR). Opportunity signals: EIOPA taxonomy or QRT changes, Solvency II review deadlines, new insurance entities, manual QRT preparation, IRRD reporting.",
};

// The original, pre-enrichment descriptions — used ONLY to detect an unedited
// module so the refresh script never overwrites a description you have changed.
export const OLD_MODULE_DESCRIPTIONS = {
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
  "MS Dynamics AX": "Prebuilt connector and integration to Microsoft Dynamics AX ERP.",
  "Machine Learning AA":
    "Predictive and advanced analytics: machine-learning forecasting and anomaly detection.",
  PowerPoint: "PowerPoint integration for automated, data-linked presentation reporting.",
  SmartInsight:
    "AI and natural-language assistant for querying data and generating narrative insight.",
  "Solvency II":
    "Insurance regulatory reporting under Solvency II: QRTs, XBRL taxonomy and SFCR/RSR.",
};

// The original Module Opportunities briefing, for the same unedited check.
export const OLD_MODULES_BRIEFING =
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
