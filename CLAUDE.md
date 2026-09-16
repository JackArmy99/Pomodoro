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
  **Cost model**: the dominant per-run cost is web-search fees (~1p/search, not
  the model). **Test mode** (toggle on `/agents`, persisted as Setting
  `test_mode`) runs on Haiku 4.5 + caps searches to 2 (~2–3p/run) for cheap
  tuning; off = full Sonnet + 5 searches. `resolveRunModel()` in
  `lib/anthropic.ts` is the single source both `web.ts` and `summariseItem` use.
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
  sourceType, status pending/approved/dismissed; **sourceBody** issuing body,
  **effectiveDate** deadline, **verified** gate) ↔ **FindingModule**.
- **Module.description** + `Setting` **product_context** = the domain grounding
  injected into every run (`buildGroundingBlock()` in `lib/anthropic.ts`); edited
  on `/modules`. Findings may map to **no** module (general EPM intel).
- **Source** (rss feed | web topic, optionally pinned to an agent),
  **ResearchBrief** (a PDF/Word/typed brief attached to an agent — researched
  as its own topic on every run, or on demand), **Setting** (key/value).

## Screens (app/)

- `/` Hub — personal tasks bucketed day/week/month + secondary opps/briefs.
- `/agents`, `/agents/[id]` — research agent overview + briefing page. Seeded
  with two beats: **Regulation & Standards** (domain-locked to IFRS/EFRAG/EIOPA/
  OECD/EC/ESMA hosts, one pinned source per domain) and **Module Opportunities**
  (broad, grounded by module descriptions).
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

Flow: **agent runs → findings (scored, module+body tagged, dated) → inbox →
review/edit/dig-deeper → verify source → approve → Brief + fan-out to clients
holding the tagged module (Opportunity/Task/Brief each; effectiveDate →
deadline/dueDate)**. Approval is **gated on `verified`** — a guard against
confident-but-wrong AI specifics reaching a client.

## Conventions

- Everything is server-rendered with server actions; forms post to actions.
- `ownerId` on records defaults to `"me"` (ready for multi-user auth later).
- Migrations are committed; data back-fills go in the migration SQL.
- **Never hand-date a migration folder.** Always create them with
  `npx prisma migrate dev --create-only` so timestamps stay monotonic. Prisma
  applies migrations in *name* order, so a hand-picked later timestamp can run
  after a migration that already created its columns → "duplicate column".
  Run **`npm run test:migrations`** (applies everything to a throwaway empty DB)
  before pushing any schema change — a machine that already has the columns will
  never reveal the bug. `npm run update` self-repairs a wedged ledger
  (`npm run fix:migrations` runs that repair on its own).
- **`scripts/update.mjs` runs its post-pull half as a fresh child process.**
  Node loads the script into memory before `git pull` replaces it on disk, so
  anything after the pull in the same process is still the *old* code. New
  post-pull steps go in `postPull()`, never inline before it.
- **Stop the app before `npm run update`.** Windows won't replace a file that a
  running process has open, and a live `npm run dev` / `dev:all` / `worker` /
  `prisma studio` holds the Prisma query-engine DLL → `EPERM … rename
  query_engine-windows.dll.node`. The updater now refuses to start if anything
  answers on port 3000, retries a locked `prisma generate` twice, and says so in
  plain English. Prisma stays pinned at **5.22** — the advertised 8.x is a major
  release candidate; don't take the upgrade prompt.
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
