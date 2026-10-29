# Beacon Knowledge Base — plan

Agreed with Jack on 29 Oct. Built from his laptop in Claude Code, one milestone
at a time, stopping after each for him to check.

## In plain English (for Jack)

Beacon can now gather a lot: manuals, webinars it watches itself, Library
items, pages. What it can't yet do is organise that into one body of knowledge,
show where each piece went, and work out what an update changes and for which
clients. This plan adds that layer.

- **Manuals are the backbone.** The topic structure comes from the manuals' own
  contents (you edit it), because manuals are versioned, so their changes can be
  measured exactly.
- **Everything else slots in, never overwrites.** Webinars, promotional pieces
  and news attach to manual topics, labelled by source. Anything the manual
  doesn't say is flagged "not in the manual yet" and re-checked automatically
  when the next manual version arrives.
- **Every topic page is a cited summary.** Each sentence links to the manual
  page or webinar second it came from; a sentence with no source is dropped.
- **Nothing changes without your approval.** A new manual version produces
  proposed changes (before, after, source); you approve or reject; everything
  is logged.
- **Clients are linked by module and release.** "This changed in Intercompany
  from release 2026 → affects these code-named clients."
- **Pilot: Consolidation**, using two versions of its PDF manual, so real change
  proposals appear from day one.

## Context

What exists (16 Oct): `KnowledgeSource → SourceVersion → TranscriptSegment`
holds manuals (paragraph + page), YouTube and Tagetik webinars (timed cues,
Whisper for the latter) and watched pages, all versioned. `lib/knowledge/diff.ts`
gives a free local paragraph diff between versions. Video summaries cite
segments with enforced citations. Findings carry modules; clients carry modules
(`ClientModule`, `in_use | licensed`) and hosting.

What's missing is the middle layer: no topic structure, no record of which topic
a passage belongs to, no history of how knowledge changed and why, and client
impact only via loose module tags on inbox items. Jack's goal: a structured,
updatable knowledge base with deltas and an audit trail ("where it's gone to and
from"), linked to clients, that later answers questions.

## Decisions (from the interview, 29 Oct)

| Question | Decision |
|---|---|
| Top-level structure | Module → topic. Manual information is the backbone; everything else slots into it |
| Authority | Webinar / promotional / news never overwrite manual content |
| Topic page | Cited summary + sources (every sentence cited; uncited dropped) |
| Updates | Propose, Jack approves; every decision logged |
| Client linking | Modules + Tagetik release (+ hosting, already stored) |
| Topic list source | Built from the manuals' contents; Jack edits |
| Non-manual claims | Labelled, flagged "not in manual yet", never merged; re-checked on each new manual version |
| Pilot | Consolidation — current + an older manual, both PDF |
| Priority questions | "What changed, and who's affected?" and "How does X work?" (cited) |

## Design

### 1. Source authority — a rule in code, not a prompt

Every `KnowledgeSource` gets `docType` and an `authority` tier:

| Tier | docType | May create… |
|---|---|---|
| 1 | `manual` (versioned, with release) | manual statements |
| 2 | `release_notes` / official docs | supplementary statements |
| 3 | `webinar` / demo | supplementary statements |
| 4 | `promotional` (white papers, e-books, marketing) | supplementary statements |
| 5 | `news` / community posts | supplementary statements |

Enforced where proposals are created and approved: a tier 2–5 source can never
edit, supersede or remove a manual statement. It can only add a supplementary
statement, labelled with its source and date. Tested.

### 2. Data model (new tables; additive only)

Created with `npx prisma migrate dev --create-only`, never hand-dated. Only new
tables and nullable columns: no table rebuild, so no data risk.
`test:migrations` and `db:check` run before every push.

- **KbTopic**: moduleId, parentId (tree, 2–3 levels), title, order, status
  (draft | approved), createdFrom. Owned by Jack; the stable spine that survives
  manual versions.
- **DocSection** (per manual version): sourceVersionId, path ("3.2.1"), title,
  level, page, startOrdinal, endOrdinal, topicId?. A manual version's own
  outline, mapped onto topics. Segments are not rebuilt; sections point at
  ordinal ranges.
- **KbPlacement**: a source passage filed under a topic: topicId,
  sourceVersionId, fromOrdinal/toOrdinal, method (section | classified |
  manual), confidence, status. This is "where the knowledge went".
- **KbStatement**: one cited sentence on a topic page: topicId, text, order,
  tier (manual | supplementary), sourceId, state (current | superseded |
  unconfirmed | confirmed | contradicted), appliesFromRelease?, supersededById?,
  citationsJson (≥1 {sourceVersionId, ordinal} that must exist; enforced like
  `enforceCitations`).
- **KbProposal**: a change waiting for Jack: topicId, kind (add | change |
  remove | new_topic | move), beforeJson, afterJson, reason,
  triggerSourceVersionId, diffRefsJson, status (pending | approved | rejected),
  decidedAt.
- **KbEvent**: the append-only audit log: at, actor (jack | job id),
  entityType, entityId, action, beforeJson, afterJson, proposalId?,
  sourceVersionId?. Written for every topic edit, placement, statement change
  and decision. Never updated or deleted.
- **KbUsage**: where knowledge went out: statementId/topicId → findingId |
  briefId | opportunityId. Recorded when an inbox item, brief or opportunity is
  created from or cites knowledge.
- `Client.tagetikRelease String?` (hosting already exists) and
  `SourceVersion.release String?` plus `KnowledgeSource.docType/authority`.

### 3. Building the topic tree from a PDF manual (free, no model)

`pdfjs-dist` is already installed (it's what pdf-parse uses):

1. PDF bookmarks (`getOutline()` + destinations → page). Most software manuals
   have them: the manual's real table of contents, exact.
2. Fallback: numbered headings ("3.2.1 Intercompany matching") using
   `getTextContent()` font size and position, cross-checked with a contents page
   if present.
3. Sections → ordinal ranges over the stored paragraph segments.

The first manual imported for a module proposes the initial topic tree (one
topic per section, to a sensible depth). Jack renames, merges, splits and
reorders it in the UI before anything is filed. Every edit is a KbEvent. Order
follows the manual's order unless Jack changes it.

### 4. Filing and cited summaries

- Manual passages file under topics through their section. Deterministic and
  free.
- One model call per topic drafts the cited summary from that topic's passages
  only (ungrounded extraction, like video pass A; schema-constrained; citations
  enforced; Haiku 5.5 in test mode). Output arrives as proposals; Jack approves
  them into KbStatements.
- Rough cost: a 400-page manual is about 200K tokens in total. On Sonnet, about
  £0.50–1 once per manual; in test mode, a few pence. Updates only send changed
  sections.

### 5. A new manual version → "what changed, and who's affected"

1. Import as a new version (existing pipeline; free).
2. Map the new outline onto existing topics by section path and title
   similarity. Unmatched new sections → `new_topic` proposals; vanished sections
   → `remove`/`move` proposals.
3. Local diff (`diff.ts`): extend `Change` to carry segment ordinals. Changed
   paragraphs → their sections → affected topics.
4. For each affected topic only, one call drafts statement changes (before →
   after, cited to the new passages) → proposals.
5. Re-check every unconfirmed supplementary statement on affected topics: does
   the new manual now confirm or contradict it?
6. Impact view (no model call): per changed topic → module → clients holding
   that module (in_use/licensed) whose `tagetikRelease` is at or after the
   version's release, shown with hosting. All code names.
7. Each approved change is logged, and can be sent to the inbox as an
   opportunity through the existing approve → fan-out flow (recorded in
   KbUsage).

### 6. Webinars and other sources slot in

- Transcript chunks are classified into existing topics (one cheap call per
  webinar; never creates topics on its own, but can propose one). Each lands as
  a KbPlacement with its timestamps, so a topic page lists "explained in webinar
  X at 12:31".
- The claims it adds become supplementary statements: labelled with source and
  date, `unconfirmed` when the manual doesn't say it, `contradicted` when it
  disagrees. Shown under the manual summary, never merged into it.
- Page and transcript text is untrusted data, never instructions (as now).
- Italian-language webinars: notes in English (existing rule); transcripts are
  never translated.

### 7. Asking it — "How does X work?"

Find the topic(s) through titles, statement text and passage text (keyword
search first, with query expansion; embeddings only if that measurably falls
short, as decided earlier). The answer is composed only from approved
statements and their cited passages, so every sentence keeps its citation.
Lower-tier claims appear separately, labelled.

### 8. Screens

- `/knowledge/base`: module → topic tree, with counts (passages, statements,
  unconfirmed claims).
- Topic page: cited summary (manual tier); "also said elsewhere"
  (supplementary, labelled, flagged); sources list; history (KbEvent timeline:
  what changed, when, from which source, approved by Jack); "used in" (KbUsage).
- `/knowledge/base/review`: proposals queue (approve / reject / edit), grouped
  by topic, with the triggering diff.
- `/knowledge/base/changes`: what changed between two manual versions and which
  clients it affects.
- Source page gains "Filed under: …", showing where its knowledge went.
- Client page gains `tagetikRelease`, and "changes affecting this client".

## Hard rules (in code, each with a test)

1. A tier 2–5 source can never change, supersede or remove a manual statement.
2. Every statement cites ≥1 stored segment of a specific source version;
   invented citations are stripped and uncited sentences dropped.
3. Nothing becomes current without Jack's approval.
4. KbEvent is append-only.
5. Clients appear by code name only; people by initials.
6. Building the outline, filing manual passages and diffing never call a model.

## Milestones (pilot: Consolidation, two PDF versions)

- **M0 — Inventory and import.** Jack puts the older and current Consolidation
  PDFs on the laptop; import both through `/knowledge` (free). Add docType,
  authority, release to sources/versions and tagetikRelease to clients; Jack
  fills releases for his clients. *Done when:* both versions are stored, each
  paragraph with its page, and every client has a release or "unknown".
- **M1 — Topic tree.** Outline extraction (bookmarks → numbered-heading
  fallback) → DocSections → proposed tree → edit UI → approve. KbEvent from day
  one. *Done when:* the older manual's outline matches its real contents
  (spot-check 20 sections by page), and Jack has approved a Consolidation tree.
- **M2 — Filing and cited summaries.** Manual passages filed by section;
  per-topic cited summaries as proposals; topic page and review queue. *Done
  when:* every approved topic has a cited summary, a sample of 10 citations each
  lands on the right page, and the cost is reported.
- **M3 — What changed, and who's affected.** Import the current version;
  outline mapping, diff → affected topics → proposals; impact view by module +
  release. *Done when:* Jack can open "Consolidation: older → current", see each
  changed topic with before/after and sources, approve them, and see the
  affected code-named clients.
- **M4 — Webinars and other sources slot in.** Classify transcripts into
  topics; supplementary statements with flags; re-check on the next manual
  version. Start with webinars already transcribed. *Done when:* a webinar on a
  Consolidation subject appears on the right topics at the right timestamps, its
  claims labelled and flagged, with no manual statement changed.
- **M5 — Ask.** "How does X work?" with cited answers; "used in" tracking on
  inbox items, briefs and opportunities.
- **M6 — Roll out and automate.** Remaining modules; the Library sweep downloads
  new manuals → import → proposals arrive in the review queue on their own.

## Verification

- New free gate `npm run test:kb` (throwaway database, no model calls; stubbed
  drafting): outline from a fixture PDF with bookmarks and one without (numbered
  headings); sections → ordinal ranges; the outline of a revised version mapped
  onto existing topics (renamed, added, removed sections); diff → affected
  topics; the tier rule (a webinar proposal against a manual statement is
  refused); citations enforced; approval writes KbEvent and nothing changes
  without it; impact = module + release + hosting.
- Existing gates stay green: `test:video`, `test:docs`, `test:portal`,
  `test:migrations`, `db:check`, `tsc`, `build`.
- Live, on the laptop: each milestone's "done when" above, with real pence from
  ModelCall.

## Out of scope for now

Embeddings / semantic search (only if keyword + expansion falls short); OCR for
scanned PDFs; automatic approval; multi-user permissions; hosting.
