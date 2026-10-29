# Beacon UI — streamlining plan

Drafted 29 Oct for Jack. Same ideas, fewer places. Nothing here changes data or
costs anything to run; it is layout, names and navigation.

## What's confusing today (from an inventory of all 16 screens)

- **8 sidebar items plus the client list**, and the phone menu only has 5
  (Briefs, Opportunities and Modules can't be reached on a phone).
- **Five separate "put something in" boxes:**
  - Research now (/agents)
  - Paste an item (/research)
  - Add a video, which appears twice, with the button once labelled "Research"
  - Add a document (/knowledge)
  - Watch a page (/knowledge)

  Research briefs (/agents/[id]) is a sixth file upload.
- **"Brief" means three things:** the agent's Briefing, an agent's Research
  briefs, and the Briefs page.
- **Waiting items appear in four places:** Agents "Needs attention", agent card
  counts, agent Recent findings, and the Inbox.
- **There are four ways to make an opportunity**, and two screens each work out
  "affected clients".
- **Module management is spread over four screens:** you add a module on a
  client page, describe it on Modules, build its tree under Knowledge base, and
  tag it on an inbox item.
- **The busiest screens:**
  - a knowledge item's page is about 10 sections, with developer text
    ("npm run…", "send this to Claude")
  - a client page has about 9 forms
  - the Knowledge page stacks 5 cards, and the webinar box depends on a toggle
    further down
- **Dead ends:**
  - Hub rows aren't clickable
  - there is no opportunity page
  - a brief says "edit it from the feed", which doesn't exist
  - the Briefs header text is out of date

## The idea: arrange it around what Jack does, in order

**Bring things in → decide → know → act for clients.** Five places, plus Setup:

| New | What it holds | Replaces |
|---|---|---|
| **Today** | My tasks + one "Needs you" strip (inbox items waiting, topic changes to approve, anything that failed) | Hub, Agents' "Needs attention" |
| **Inbox** | Everything waiting for a yes/no: research findings now; knowledge-base change proposals later (M2–M3) | Inbox, the KB review queue |
| **Library** | Tabs: **Topics** (module → topic trees), **Sources** (videos, manuals, pages), **Webinars** (the shortlist) | Knowledge, Knowledge base |
| **Clients** | List, then one client page with tabs: **Overview** (modules, release, hosting, people), **Work** (tasks, opportunities, intel), **What affects them** | All clients, client pages |
| **Pipeline** | Tabs: **Opportunities** (the board) and **Intel** (approved briefs) | Opportunities, Briefs |
| **Setup** (gear, bottom) | Research agents, Modules & product context, portal access, test mode, spend | Agents, Modules, scattered toggles |

The sidebar goes from 8 items to 5 + Setup, and the phone menu shows the
same 5. The client list stays in the sidebar.

### One "Add" box instead of six

The same box sits at the top of Inbox and Library, and Beacon works out what
you gave it:
- **a YouTube or Community webinar link** → watch it
- **a Community page link** → watch the page
- **a PDF or Word file** → import it, asking only "What is it? / Module /
  Release / New edition of…"
- **plain text, or a question** → one-off research into the Inbox

Agents keep their own reference files on their Setup page; that's the only
other upload.

### Plain names

| Today | Becomes |
|---|---|
| Briefing (agent) | What to look for |
| Research briefs (agent) | Reference files |
| Briefs (page) | Intel |
| Dig deeper | Research more |
| Mark source verified | I've checked the source |
| Test mode (Haiku/Sonnet) | Cheap test runs (~2p) |
| Portal access | Tagetik Community access |
| segments / editions | lines / versions |

### Quieter detail pages

- **Knowledge item page:** title, what it is, summary or contents, and changes.
  Run steps, fetch logs, previews and anything mentioning `npm` move into one
  **Technical details** panel, closed by default.
- **Client page:** tabs rather than one long scroll; one "Add…" menu rather
  than four bottom forms.
- **Agent page:** one Save; "What to look for" first; sources and reference
  files below.
- **Every list row is a link.** There's a simple opportunity page, and an edit
  form for intel.

### How the Knowledge Base slots in

- **Library → Topics** holds the trees (built today in M1).
- **Inbox** gets the change proposals from a new manual edition (M3).
- **Clients → What affects them** shows "Intercompany changed in 2026 → this
  client" (M3).

So the KB adds no new menu items.

## Phases (each one shippable, checked with one screenshot)

1. **U1: Navigation and names.**
   - New sidebar and phone menu (old addresses redirect, so no bookmark breaks).
   - The renames above.
   - Remove the duplicate "Add a video".
   - Fix the dead ends: clickable Hub rows, header text, the brief's edit form.
2. **U2: One Add box.** Detection of link, file or text. The old boxes are
   removed.
3. **U3: Library with tabs**, plus the quieter knowledge item page with
   Technical details collapsed.
4. **U4: Clients with tabs**, plus Setup → Modules as the single home for
   modules (add, describe, licences, tree).
5. **U5: Today's "Needs you" strip**, and Pipeline (Opportunities + Intel) with
   an opportunity page.

The Knowledge Base milestones (M2+) carry on in parallel. They land in
Library, Inbox and Clients as above.

## Rules while doing it

- No data model changes for U1–U5; every screen keeps its server actions.
- Old URLs keep working (redirects), and existing free gates stay green.
- One phase per round, so Jack can judge each one from a screenshot.
