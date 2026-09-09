# CLAUDE.md — project brain

Read this first. It's the durable context for any Claude Code session on this
repo. Keep it updated as the project evolves. The running decision log is in
`PROJECT_LOG.md`.

## What this is

**Beacon** — a market-intelligence & opportunity hub for a small **CCH Tagetik
(EPM) consultancy**. NOT a ticketing tool (ticket-solving lives in TopDesk). It
centralises: personal tasks, clients & their module licences, vendor news
briefs, opportunities, and **research agents** that gather intelligence.

Confidentiality: clients are stored by **code name**, people by **initials** —
no real client names/PII in the app.

## Stack

- **Next.js 14 (App Router) + TypeScript + React** — UI in `app/` + `components/`.
- **Prisma + SQLite** (local dev; `prisma/dev.db`). Hosted later = swap to Azure
  Postgres (Prisma provider change).
- **Tailwind CSS**.
- **Anthropic SDK** (`claude-sonnet-5` default) for summarising/scoring +
  **web_search** server tool for research. Key in `.env` as `ANTHROPIC_API_KEY`.
- Server logic = server actions in `app/actions/*` + `lib/*`. No separate API.

## Run / update

```bash
npm install
npm run setup     # first time: generate + migrate + seed
npm run dev       # http://localhost:3000
npm run update    # pull latest + install + migrate (keeps data); then npm run dev
npm run backup    # timestamped copy of prisma/dev.db
npm run doctor    # diagnose the AI path: key → Claude call → live web search
```
Destructive: `db:reseed` (confirm + auto-backup) and `db:reset` wipe all data.
`.env` is git-ignored and auto-created from `.env.example` (predev/presetup).

## Data model (prisma/schema.prisma)

- **Client** (code name, type active/prospect, hosting) — `ClientModule` links
  to **Module** with status `in_use` | `licensed` (licensed-not-used = upsell).
- **Person** (initials) per client.
- **Task** (personal to-dos; urgency/dueDate/estimate/bookedInTeams).
- **Brief** (intel record) ↔ **BriefModule** / **BriefClient**.
- **Opportunity** (pipeline: open/pursuing/won/lost; value; category via
  **OpportunityCategory**; originBrief).
- **Agent** (research agent: archetype finder|retriever|comparer, briefing,
  guardrails, lookbackDays) → **AgentRun** (run history + est cost).
- **Finding** (research inbox item: relevance high/medium/low, agentId,
  sourceType, status pending/approved/dismissed) ↔ **FindingModule**.
- **Source** (rss feed | web topic, optionally pinned to an agent),
  **ResearchBrief** (a PDF/Word/typed brief attached to an agent — researched
  as its own topic on every run, or on demand), **Setting** (key/value).

## Screens (app/)

- `/` Hub — personal tasks bucketed day/week/month + secondary opps/briefs.
- `/agents`, `/agents/[id]` — research agent overview + briefing page.
- `/research`, `/research/[id]` — inbox + finding detail (edit / dig deeper /
  approve fan-out).
- `/briefs`, `/briefs/[id]` — briefs + "who's affected".
- `/opportunities` — pipeline + categories.
- `/clients`, `/clients/[id]`, `/modules`, `/modules/[id]`.

## Research engine (lib/research/)

- `web.ts` `runWebResearch` — Claude web_search → scored JSON findings; stable
  system prefix is prompt-cached; the search tool type falls back
  (`web_search_20260209` → `web_search_20250305`) if the account rejects the
  newer one; `webDeepDive` for enrich-in-place.
- `fetch.ts` — `runFinderAgent` (**the briefing IS the search topic**, plus
  pinned sources, attached research briefs, and a **triage feedback** block from
  approved/dismissed findings), `createWebFindings`, `processFinding`,
  `researchFromBrief`, `researchAdHoc`, `deepenFinding`.
- Steering lives only on `Agent.briefing` (the old global `research_instructions`
  Setting was retired — it was being injected twice).
- `youtube.ts` (captions), `extract.ts` (PDF/Word text).
- `lib/anthropic.ts` `summariseItem` (summary + modules + relevance).

Flow: **agent runs → findings (scored, tagged) → inbox → review/edit/dig-deeper
→ approve → Brief + fan-out to clients holding the tagged module (Opportunity/
Task/Brief each)**.

## Conventions

- Everything is server-rendered with server actions; forms post to actions.
- `ownerId` on records defaults to `"me"` (ready for multi-user auth later).
- Migrations are committed; data back-fills go in the migration SQL.
- Commit at meaningful checkpoints; branch `claude/work-dashboard-ticketing-zxi7p5`.

## Where we are / what's next

- Done: hub/tasks, clients+modules mapping, briefs→affected-clients→opportunity,
  research inbox, **Finder agents** (overview, briefing, relevance, run history,
  cost, ad-hoc, fan-out approve), triage-learning loop, prompt caching.
- Hardening round (diagnostic audit): `npm run doctor`, briefing-as-topic fix,
  per-agent research briefs resurfaced, guarded re-seed, pending states on every
  slow button, failed runs always recorded.
- Next: test & tune the Finder live; then **Retriever** (point at video/manual)
  and **Comparer** (version-diff manuals); later ASR for caption-less video,
  guardrailed portal login, hosting (Azure) + scheduling + team sharing.

## Testing the Finder (quick loop)

0. `npm run doctor` — must pass before anything else. A silent "Nothing new"
   is almost always a missing/invalid `ANTHROPIC_API_KEY` or no API credit
   (billed separately from a Claude Max subscription).
1. `/agents` → open "General Research" → give it a focused briefing.
2. **Run now** → check `/research`: relevance + module tags sensible?
3. Approve the good ones, dismiss the noise → **Run again**: it now gets a
   "signals from past triage" block and should sharpen. Tune the briefing.
