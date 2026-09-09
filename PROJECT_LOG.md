# PROJECT_LOG — decisions & rationale

Newest first. Each entry: what we decided and why. Read alongside `CLAUDE.md`.

## 2026-09 — Finder v2: efficiency, learning, continuity

- **Continuity via `CLAUDE.md` + `PROJECT_LOG.md`** (not claude.ai "Projects",
  which Claude Code doesn't use). `CLAUDE.md` is auto-loaded so any new session
  picks up instantly.
- **Retrieval stays on Claude's built-in web search** for now (one key, simple);
  upgrade path (Tavily/Exa/Firecrawl/Jina, feeds/APIs) noted for later if
  quality/cost warrants.
- **Triage learning loop**: each Finder run now includes a "signals from past
  triage" block built from the agent's approved (valuable) vs dismissed (noise)
  findings, so it self-corrects. Reuses `Finding.status` — no new model.
- **Prompt caching**: web-research system prefix is stable + cached; per-run
  details moved to the user message. Cheaper repeat/`Run all` runs.

## 2026-09 — Research agents (Slice 3a/3b)

- **Agents are first-class, topic/beat, mixing methods**; sources/briefs moved
  under agents (existing data migrated to a default "General Research" agent).
- **Three archetypes**: **Finder** (built — deep web research), **Retriever**
  (point at video/manual — next), **Comparer** (version-diff manuals — next).
  Only Finder UI shipped (no dead controls); `archetype` field ships in model.
- **Briefing is the driver** (name + briefing enough to run); pinned feeds/topics
  optional. Findings are **relevance-scored** in the same web-search call,
  **tagged to the agent**, shown-all sorted high→low; **deduped by link** (one
  shared finding). Per-agent **run history + estimated cost**; overview has a
  **needs-attention** strip + **ad-hoc "research now"**.
- **Approve → client fan-out**: scans the finding's modules against the
  client↔module mapping and lists clients holding them as a checklist (default
  **Opportunity**, or Task/Brief). One finding → openings across affected clients.
- **Edit before approve** + **dig deeper** (enrich the finding in place, optional
  steer note).

## 2026-09 — Slice 3 first build (research ingestion)

- Research inbox: RSS feeds, manual **paste** bridge (for login-gated text),
  **web-research topics** (Claude web_search), **YouTube** captions, and
  **research briefs** (PDF/Word upload or typed) — all summarised → inbox.
- AI is guarded: works without `ANTHROPIC_API_KEY` (raw items); summaries switch
  on with the key. Editable global + per-source research instructions.
- **Video reality**: Claude can't watch/hear; captioned video = easy, no-caption
  = ASR (later), gated portals = login automation (later). Loopback audio
  capture is the universal fallback for locked streams (manual).

## Earlier — Slices 1–2 (foundation)

- **Slice 1**: personal hub — tasks (day/week/month, urgency, "booked in Teams"
  tick), clients (**code names**) + people (**initials**), briefs, opportunities.
  Not a ticketing tool (TopDesk stays). Left sidebar = clients.
- **Slice 2**: module/licence mapping from the client's spreadsheet (24 clients,
  13 modules), **in-use vs licensed** (upsell signal), per-module "who's
  affected", editable per client with + / −. Then brief→module→affected-clients
  →opportunity flow, plus self-defined opportunity categories.

## Standing architecture decisions

- **Stack chosen to grow local → hosted → team without a rewrite**: Next.js +
  Prisma + real DB; `ownerId` on records for future auth.
- **Hosting target = Azure** (App Service/Container Apps; SQLite → Azure
  Postgres; Entra ID; Key Vault). **Power Apps "code apps"** could host the React
  UI later, but agents/DB must run on Azure Functions behind it — keep a clean
  UI/engine seam.
- **Guardrails for automation** (portal agent, later): domain allowlist,
  read-only, secure creds, human-in-the-loop inbox, dry-run + logging, caps,
  kill switch, isolation. No detection-evasion/DRM circumvention.
- Updates via `npm run update` (restores package files, pulls, installs,
  migrates — keeps data). Backups via `npm run backup`.
