# PROJECT_LOG — decisions & rationale

Newest first. Each entry: what we decided and why. Read alongside `CLAUDE.md`.

## 2026-09 — Diagnostic audit & hardening

A full review of everything built so far, then the fixes we agreed to take.

- **The AI path had never actually run.** Everything downstream was untested
  guesswork, so proving it comes first: **`npm run doctor`** checks `.env`, makes
  a real Claude call, and tries a live web search, naming the failing step
  (missing key / no API credit / web search unavailable). API credit is billed
  separately from a Claude Max subscription — that caught us out.
- **The briefing wasn't being searched.** `runFinderAgent` searched the agent's
  *name* and passed the briefing only as side instructions, so a rich briefing
  produced generic results. The briefing (falling back to mission, then name) is
  now the search topic itself.
- **Steering was injected twice** (global `research_instructions` Setting *and*
  the agent briefing). The global Setting is retired; `Agent.briefing` is the one
  source of steering.
- **Search tool fallback**: `web_search_20260209` → `web_search_20250305` on a
  400, cached after the first success, so an older account doesn't hard-fail.
- **Cost estimate was Sonnet-only** — now per-model rates.
- **`ResearchBrief` was orphaned** (model + engine existed, no UI). Resurfaced
  *per agent*: upload a PDF/Word brief or paste one, it stays its own topic,
  researched on every run and runnable on its own. Distinct from the briefing,
  which is the agent's standing character.
- **`db:seed` was a footgun** — one word, wipes everything. Renamed
  **`db:reseed`**: auto-proceeds on an empty database, otherwise shows what
  would be lost, requires typing `RESEED`, and takes a backup first.
- **Silent slow buttons**: every AI-bound action (Run, Run all, Research,
  Summarise, Dig deeper, Add video) now uses a `SubmitButton` with
  `useFormStatus` — disabled, spinner, "Researching…" — so a 20-second run
  doesn't look broken or invite double-clicks.
- **`runAllAgents` swallowed errors**: failures now record an `AgentRun` with the
  reason, same as a single run.

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
