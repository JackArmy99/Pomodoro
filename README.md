# Beacon — EPM Intelligence & Opportunity Hub

A centralised hub for a small EPM consultancy to track **vendor news briefs** and
**client opportunities** — organised per client. This is **not** a ticketing tool
(that stays in TopDesk); it's for market intelligence and future work.

This is **Slice 1**: the manual hub. Later slices add license mapping, automated
research agents (RSS, newsletters, video digests), and human-approved client
outreach. See the plan for the full roadmap.

## Tech stack

- **Next.js (App Router) + TypeScript** — one codebase that runs locally now and
  deploys online later.
- **Prisma + SQLite** — a real database in a local file. Going hosted later is a
  config change, not a rewrite.
- **Tailwind CSS** — styling.

## Getting started (first time)

You need **Node.js 18+** installed. Then, from the project folder:

```bash
npm install          # install dependencies
npm run setup        # generate the client, create the database, add sample data
npm run dev          # start the app
```

Open <http://localhost:3000>.

`npm run setup` runs three things for you: `prisma generate`, the first database
migration, and the seed script (3 sample clients, briefs and opportunities).

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode |
| `npm run build` / `npm run start` | Production build and run |
| `npm run update` | Pull the latest code + apply DB changes **without losing data** (backs up first) |
| `npm run backup` | Save a timestamped copy of your database to `prisma/backups/` |
| `npm run db:studio` | Open Prisma Studio to browse/edit the database |
| `npm run db:seed` | Re-load the sample data |
| `npm run db:reset` | **Wipes** and rebuilds the database with sample data — only for a clean start |

### Updating safely

Stop the app (`Ctrl+C`), then run `npm run update` and follow its final
instruction (`npm run dev`). It backs up your database, pulls the latest code,
and applies migrations while keeping your data.

To restore a backup: stop the app, then copy a file from `prisma/backups/` over
`prisma/dev.db`.

## What's in Slice 1

- **Clients & prospects** — a directory; each has its own page.
- **Briefs** — vendor updates/newsletters/videos, with a source link and the
  clients they're relevant to.
- **Opportunities** — leads with a stage (open → pursuing → won/lost), value,
  likelihood, deadline, next step, optionally sparked by a brief.
- **Per-client view** — one page aggregating a client's modules, people, tasks,
  briefs and opportunities.
- **Modules & licences** — each client's Tagetik modules, marked **In use** vs
  **Licensed** (owned but unused = an upsell opening), editable with + / − per
  client. The **Modules** page shows who's affected by any module.
- **Research inbox** — add RSS/blog feeds and hit *Fetch now*, or *paste* any
  content (e.g. login-gated release notes). Items are summarised by Claude and
  land in a triage inbox; *Approve* turns one into a Brief with module tags. AI
  summaries need an `ANTHROPIC_API_KEY` in `.env` (see `.env.example`); without
  one, items still arrive as raw text.
- **Filters / quick views** — filter briefs by client or source type, clients by
  active/prospect, opportunities grouped by stage on the Hub.

The client + module data is loaded from `prisma/client-modules.json`. To add new
clients from that file without wiping anything, run `npm run clients:add`.

## Project structure

```
app/
  page.tsx              Hub overview
  briefs/page.tsx       Briefs feed + filters
  opportunities/page.tsx Pipeline by stage
  clients/page.tsx      Client directory
  clients/[id]/page.tsx Per-client aggregate
  actions/              Server actions (create/update/delete)
components/             Nav, cards, forms
lib/                    db.ts (Prisma client), format.ts (helpers)
prisma/                 schema.prisma, seed.ts
```

## Notes

- The local database file (`prisma/dev.db`) and `.env` are git-ignored. Copy
  `.env.example` to `.env` if you don't have one.
- Secrets (API keys, portal logins) will live in `.env` in later slices and must
  never be committed.
