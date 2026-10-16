# PROJECT_LOG — decisions & rationale

Newest first. Each entry: what we decided and why. Read alongside `CLAUDE.md`.

## 2026-10-16 — Webinars without captions: transcribed locally, chosen by Jack

- Jack, rightly: caption-less video had been settled weeks ago (his hermes
  example: download → audio → Whisper) and was only parked until media access
  was known. With the MP4 found, it was built rather than re-asked.
- **Local, not a cloud service:** Claude can't take audio; a third-party
  speech-to-text service would send Wolters Kluwer content off the laptop.
  ffmpeg + Whisper (transformers.js/ONNX) run on the laptop, free per video.
  whisper-base was 4.6× real time but mangled product names; whisper-small is
  ~2.2× (≈11 min for a 25-min webinar) and good enough, plus a glossary.
- **Jack chooses what is watched:** the Library's own Asset Type filter
  (`?asset_type=webinars`, found by trying the likely forms), then he ticks
  items on a shortlist. Nothing downloads until he does. "How far back" is
  still his to decide; the shortlist shows the newest page.
- **Nothing is watched twice:** one identity per item (`libraryKey`), shared by
  pasted links and the shortlist; dismissed items are remembered.

## 2026-10-16 — First run on the laptop: four things only real Windows showed

Jack asked to test the Tagetik video watcher; the session ran on his laptop.

- **Live models verified:** doctor passed Sonnet 5 and Haiku 5.5 on every
  request shape. Its web-search check was a false pass (errors inside a 200
  reply) — fixed to count results.
- **The webinar preview hit an expired portal session**, disguised as a 200
  "Please wait" page that redirects to `/auth/login`. Previews never checked for
  that, and `portal:check` tested the public homepage so it always passed. Both
  now check the address, against a members-only page.
- **The update's Playwright restore installed the wrong version** — fixed by
  pinning it in the setup marker.
- **The test gates were unsafe on a real machine:** one would have deleted
  Jack's saved portal sign-in, one spent money because `.env` holds a key, and
  two couldn't start on Windows at all. All fixed; every gate now passes on
  Windows.

Lesson: "passes in the cloud" never meant "safe on the laptop". The gates had
only ever run where there was no key, no profile and no Windows.

Later the same day:
- **Why sign-ins kept "expiring":** the Community login is a session-only
  cookie (`__ac`), discarded whenever the browser closes. Beacon now saves and
  restores it; `portal:login` proves it survives a restart.
- **The webinar test answered the open question.** The player is Tagetik's own
  video.js page serving a plain ~60 MB MP4 from `api.tagetik.com` (already
  allowlisted). No captions — the transcript needs speech-to-text. Local
  Whisper is the recommended route (free per run, nothing leaves the laptop).
- **The Library's real structure is captured**, after fixing a sample script
  that had silently failed on every preview (`__name` injected into page code).
  The sweep parser can now be written against real markup.

## 2026-10 — Test mode on Haiku 5.5; doctor checks both models; a cloud key

- **Why:** faster progress. The bottleneck was never credits, it was the test
  loop (cloud builds with no API key → Jack tests on Windows → screenshots). A
  spend-capped key in the cloud environment lets sessions run and tune real
  summaries, assessments and Finder runs themselves.
- **Key setup:** separate key in a "Beacon – cloud testing" workspace with a
  monthly limit, held as the environment variable `ANTHROPIC_API_KEY`. A
  separate workspace because limits are per workspace, spend shows separately,
  and revoking it can't break Jack's laptop. Not a network secret:
  `api.anthropic.com` bypasses the proxy that injects those.
- **Haiku 5.5** ($0.10/$0.50 vs Haiku 4.5's $1/$5; ~30% bigger tokenizer, so
  ~7–8× cheaper in practice). Override with `ANTHROPIC_TEST_MODEL`.
- **Found on the way:** Haiku 4.5 rejects `effort`, which `summariseItem` sends —
  test mode was very likely failing on every triage and assessment (to be
  confirmed live). The web-search tool type was cached across models, so a
  Sonnet run could lock Haiku out of the fallback. Cost display would have shown
  5.5 at 4.5's price. All fixed; doctor now checks both models with the app's
  real request shapes.
- Thirty days of Jack's real usage to this point: **$1.67** ($1.32 tokens,
  $0.35 web search).

## 2026-09 — "Try again" was turning pages into video jobs; every run logs its steps

- A page retry failed with `network_error`, an error only the YouTube code can
  produce. `ResearchJob.kind` defaults to `"video"` and `requeueSource()` set no
  kind; the worker's routing fell through to the video pipeline. Fixed with
  `retryKindFor()` / `jobHandlerFor()` in `lib/knowledge/jobKinds.ts`.
- Jack asked for "a log of what step the agent is on". Every run now records
  timed steps with the number that explains them, shown as **What it did** with
  the job kind. A step is recorded before the access gates, or the commonest
  early failure showed an empty timeline.

## 2026-09 — Portal: survive an update, see the player, reach the inbox

- `npm run update` silently uninstalled Playwright (git restore + `npm install`
  pruning a saved-then-discarded dependency). Now `--no-save` plus a marker the
  updater re-heals from; `portal:setup` launches Chromium to prove it.
- The preview hid where a webinar's video lives (iframe players, off-allowlist
  hosts). It now reports embeds and refused hosts — recorded, never fetched.
- **Add to the inbox**: the only paid step for a page (one `summariseItem`
  call); watching and diffing stay free.

## 2026-09 — Library sweep: design settled, not yet built

- The Library (`community.tagetik.com/library`, ~3,500 assets) is a **list**:
  track items by link, never diff the page text.
- Collect: **Webinars, How-to guides/manuals, Newsletters, White papers,
  E-books**. How-to guides/manuals are downloaded (only new ones, size cap
  `PORTAL_MAX_DOWNLOAD_MB`, default 50) and go through the document pipeline so
  each version is diffed. Everything else becomes a pending inbox item (a
  potential opportunity). Dedupe on `Finding.externalId = library:<href>`.
- **A button for now**, scheduling later (Jack's call).
- Webinars: Jack cited `paulthewebdeveloper/hermes-research-agent` — checked: it
  uses yt-dlp + whisper.cpp + ffmpeg, so caption-less transcription is real. The
  open question is reaching the media behind the portal login at all; the
  preview's embeds box decides it.
- The parser must be written against the real markup (`browser.ts` `sample()`),
  not a guess. A watched page reads ONE page and never follows links — so
  pointing it at the listing does not reach the webinar.

## 2026-09 — The Tagetik portal, safely

- **Jack signs in himself** in a real browser (`portal:login`); Beacon reuses
  the session and never stores the password. The profile is a real Chromium
  profile, so its own password manager is switched off and `portal:check`
  **counts** saved passwords (0) — evidence, not assurance.
- Guardrails are code, not prompts: host allowlist (widened only via `.env`),
  https only, paced, page-capped, every URL logged, **stop on 429/403**. Off
  until the `portal_enabled` toggle — its label is Jack's recorded permission.
- "The most human way possible" = considerate (real browser, one page at a time,
  unhurried, stops when pushed back), never disguised. No CAPTCHA solving,
  stealth, proxy rotation or user-agent spoofing — being undetectable is a
  different property, and it would hide our activity from Wolters Kluwer.
- A `.mjs` script statically importing `.ts` failed on Jack's Node only;
  `node --check` had "passed". Scripts needing project code are `.ts` now, and
  new scripts are executed, not just syntax-checked.

## 2026-09 — Manuals: store the original, diff the versions, never rewrite

- Jack's reasoning: answers drawn from a rewrite can't be trusted, so **search
  the original** and spend effort only on **what changed** between versions.
- Import is free (no model call); a re-upload under the same name is a new
  version with a local paragraph diff. Rewording reads as CHANGED (Dice
  similarity on punctuation-stripped words — the first version's maths split a
  lightly edited sentence into add + remove).
- Keyword weakness on synonyms → **query expansion** first; embeddings only if
  that measurably falls short.
- Multi-agent orchestrators: Jack's colleagues use them and they're not as
  expensive as first implied. Decision: per-stage model/prompt config gets most
  of the benefit; revisit orchestration when a stage needs it.

## 2026-09 — Video summaries that teach, in English, that parse

- The first summary judged the video ("generic AI content") instead of teaching
  it — the grounding block's triage rule was in the extraction prompt. Now two
  passes: extract with **no grounding**, then classify from the notes.
- Bar set by Jack: a Tagetik webinar summary detailed enough to **give to a
  client**. Lists are enumerated, specifics kept, every point cited to a second
  of the video.
- Replies are schema-constrained (`output_config.format`) after free-prose JSON
  failed three times; long notes stream with a per-model cap and split on
  truncation. Notes are **always English**; transcripts are never translated.
- A 67-minute German video cost 38p over ~4 runs (~9–12p a clean run).

## 2026-09 — Windows "file in use", three times, and a corrupted table

- `prisma generate` hit EPERM three ways: a running app, the updater itself
  (an in-process PrismaClient holds the engine DLL forever), and an orphaned
  worker (killing npm left node alive). Fixes: the updater re-execs its post-pull
  half, repairs run as child processes, process groups are killed, the engine
  file itself is tested for a lock, and `npm run stop` exists.
- The mis-ordered migration had already written column **names** into Finding
  rows (SQLite treats an unknown double-quoted identifier as a string). A guarded
  repair migration fixed them; `npm run db:check` now catches the class.

## 2026-09 — Migration ordering bug (P3018) and the guard that was missing

`npm run update` failed with `duplicate column name: contentRevision`. Two
defects, both from one mistake: I hand-dated `revision_aware_verification` as
`20260916090000` while Prisma auto-dated `add_knowledge_base` `20260915143122`.
Prisma applies migrations in **name** order.

- Locally I had applied verification first, so the generated knowledge-base
  `Finding` rebuild baked `contentRevision`/`verifiedRevision`/`verifiedAt` into
  its CREATE *and* its INSERT…SELECT. Any machine applying in name order created
  those columns in the rebuild, then failed on the later ALTER.
- Worse and unobserved: on an **empty** database the knowledge-base INSERT
  selects `contentRevision` from a table that doesn't have it yet — so
  `npm run setup` on a new machine was broken too.

Fixes: renamed the verification migration to `20260915142500_…` so it sorts
first (renaming, not editing an already-applied migration, avoids checksum
trouble); `scripts/fix-migrations.mjs` repairs a wedged ledger automatically
inside `npm run update` (clears the failed record, records the renamed migration
as applied — the columns genuinely exist, so no data is touched);
`npm run test:migrations` applies the whole history to a throwaway empty DB.

Verified by reproducing the exact failure on a copy of the dev database
(P3009 → repair → clean deploy, Finding rows and columns intact), and by
confirming the new gate FAILS when the broken order is restored.

**Root cause worth remembering:** I never ran a from-scratch migrate. A machine
that already has the columns cannot reveal this class of bug.

## 2026-09 — Video research M1: durable captions-first ingestion

First milestone of the YouTube Retriever. Pasting a link no longer fetches
captions inside a server action, joins them into one string and truncates to
8,000 characters — that path is deleted.

- **Knowledge base schema**: `KnowledgeSource` / `SourceVersion` /
  `TranscriptSegment` / `KnowledgeChunk` / `AnalysisRevision` / `ResearchJob` /
  `ModelCall` (+ `Finding.knowledgeSourceId`, unique → one Finding per video).
  The **full** timestamped transcript is stored; nothing is truncated.
- **Durable worker** (`scripts/research-worker.ts`, `npm run worker`, or
  `npm run dev:all` to run it beside the app). Atomic claim, renewable lease +
  heartbeat, resume-from-stage, cancel. Verified: an orphaned job whose worker
  "died" (expired lease) is reclaimed and finished by a live worker.
- **Zero new dependencies**: `youtube-transcript` already returns per-cue
  `offset`/`duration` and typed errors, so timestamps and failure classification
  came free. No yt-dlp/ffmpeg/Python (deferred with the visual work to V1b).
- **Idempotent submission**: 8 URL shapes (watch/youtu.be/Shorts/embed/bare id,
  with tracking and `t=` params) collapse to one canonical source; playlists,
  other hosts, malformed ids and embedded credentials are rejected. Verified.
- **Honest failure reporting**, sharpened by a real bug found in testing: the
  transcript library reports "video unavailable" both for a private/deleted
  video and when it simply couldn't load the page, and a blocking proxy answers
  with an HTTP error that looks like YouTube responding. Rather than guess, an
  unconfirmed fetch now reports `video_or_network` and names both
  possibilities. A queued job with no worker running says so explicitly.

**Not verified here:** this container's egress blocks youtube.com, so real
caption retrieval could not be exercised — only the surrounding machinery. That
gate belongs on Jack's laptop.

## 2026-09 — Verification bound to a revision; approval made atomic

Two defects found by the video-research brief's static review of this repo, both
real, both fixed ahead of that feature (its milestone 4 assumes them):

- **Verification was not revision-aware.** `Finding.verified` was a plain
  boolean, so editing, re-summarising or digging deeper on a *verified* finding
  left the tick in place while the content changed — unreviewed text could reach
  a client. Now `contentRevision` / `verifiedRevision` / `verifiedAt`:
  `CLEARS_VERIFICATION` (`lib/research/revision.ts`) is spread into every content
  mutation (`updateFinding`, `processFinding`, `deepenFinding`), and
  `isVerifiedCurrent()` — tick matches current revision — gates the UI and
  `finalizeApprove`.
- **Approval was neither atomic nor replay-safe.** It created the Brief, looped
  clients creating Opportunities/Tasks, then marked the finding approved, with no
  transaction — a double-submit duplicated everything. Now one
  `prisma.$transaction` with a re-check inside, plus an early guard on
  already-approved findings.

### Video research (YouTube Retriever) — decisions taken
Reviewed the "Beacon video research V1" brief. Settled: **captions-first V1** —
full timestamped transcript, cited summary, searchable knowledge; **no** video
download / frame analysis (defers the yt-dlp + ffmpeg + vision cost, the Windows
media-tooling setup, and the ToS/IP-block exposure) — visuals become V1b. Storage
starts **lean** (transcript segments + cited summary + FTS) but the brief's full
claim/citation/chunk evidence graph remains the intended destination, not a
discarded idea. A durable local worker (not a detached promise) owns video jobs.

## 2026-09 — Per-source run visibility

Answers "no news vs. misfired": each run now records a per-source breakdown
(`AgentRun.detail` JSON) — the briefing search, each pinned source, each brief —
with its own count and, when zero, a plain reason ("no news"). Shown under each
run in the agent's history. `RunTally.sources` carries it up from
`runFinderAgent`; `executeRun`/`recordRun` persist it.

## 2026-09 — Domain grounding + regulatory beats + verify/deadline

The live Finder found real market news but mapped it to the wrong modules
(guessing from bare names) and drifted broad. User reviewed a regulatory context
pack; decisions folded in.

- **Grounding:** `Module.description` + editable `Setting` `product_context`,
  injected into every run via `buildGroundingBlock()`. Findings may now map to
  **no** module (general EPM intel) instead of a forced wrong tag. Edited on
  `/modules`.
- **Two seeded beats** (user's model, not the pack's 5): **Regulation &
  Standards** — domain-locked to the authoritative hosts (IFRS/EFRAG/EIOPA/OECD/
  EC/ESMA/DNB), with one pinned web source per domain for depth in a single
  agent; **Module Opportunities** — broad, grounded by module descriptions.
  Vendor beat dropped (user builds a Tagetik-site agent separately).
- **Provenance + honesty:** every finding carries `sourceBody` (issuing body) and
  a required source url; the pack's own hyper-specific citations are treated as
  unverified. A **`verified` gate** blocks fan-out to client opportunities until
  a human confirms the source.
- **Deadlines:** `Finding.effectiveDate` captured from the item and carried into
  `Opportunity.deadline` / `Task.dueDate` — the FY2027 wave becomes dated
  pipeline.
- **Honest scope call:** stayed on domain-locked web_search (not true page-diff
  monitoring). The pack wants "what changed on EFRAG this week"; that needs a
  web_fetch + snapshot Comparer, deferred by user choice.

## 2026-09 — "Nothing new" root-caused + made self-diagnosing

A briefing that produced a rich digest in Claude chat returned "Nothing new" in
the app. Diagnosed as the app's structured contract failing invisibly, not a
model/key problem.

- **`pause_turn` was never handled** (prime suspect). web_search runs a
  server-side loop that stops at `pause_turn` when it hits its cap;
  `createWithSearch` did one `messages.create` and returned, so the final JSON
  answer was often never produced → 0 items → "Nothing new". Now resumes the
  paused turn (re-send messages + paused assistant turn, per the API's
  server-tool pattern), up to 4 continuations.
- **Made empty runs explain themselves.** `runWebResearch` returns a `reason`
  (`paused` / `no_text` / `parse_failed:…` / `no_items`), threaded through
  `RunTally` to `AgentRun.message` and shown in run history in plain English;
  also `console.warn`'d server-side. "Nothing new" is no longer a black box.
- **Hardened the JSON path**: max_tokens 3000 → 8000 (truncation), strip
  ```code fences before parsing, and a post-search "reply with the JSON array
  only" line in the user turn (where Haiku most needs it).
- **Stopped silently dropping items**: a `title` is enough (url optional);
  url-less synthesised items dedupe by normalised title instead of being
  discarded for lacking a URL.
- Deferred: structured outputs (`output_config.format`) as a guaranteed-valid
  path — only if `parse_failed` persists, and after verifying it combines with
  the web_search server tool.

## 2026-09 — Agents UX cleanup + cheap Test mode

First real runs surfaced usability and cost issues; fixes agreed by Q&A.

- **Cost reality corrected.** A test run cost ~8p — the user assumed the model
  and wanted a cheaper/open-source one. Diagnosed: ~5p was **web-search fees**
  (~1p/search × up to 5), model-independent, and the search tool is
  Claude-only, so switching providers loses research entirely. Real levers:
  fewer searches + Haiku for tokens. Haiku 4.5 is the cheapest sensible model.
- **Test mode** (Haiku + 2 searches, ~2–3p/run) as a persisted toggle on
  `/agents` (`Setting` `test_mode`). `resolveRunModel()` in `lib/anthropic.ts`
  is the one place model + search-cap are decided; `web.ts` threads the model
  through `createWithSearch`/`estimateCostCents`, and `summariseItem` honours it
  too. Off = full Sonnet + 5 searches.
- **"Research now" takes a PDF/Word file** as well as a typed topic (extracted
  text becomes the query via `extractText` → `researchAdHoc`).
- **Collapsed the two agent-page PDF inputs**: removed "append PDF to briefing"
  (and the `appendBriefingFromFile` action); Briefing is text-only (the standing
  focus), Research briefs is the single upload/paste for a specific document.
- **Discoverability**: `/agents` "Finders" → "Your agents"; each card now has an
  explicit **Configure** button (was an easy-to-miss text link).

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
