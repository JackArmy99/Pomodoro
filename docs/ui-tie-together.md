# Beacon UI — make it tie together and explain itself

Jack's spec, 29 Oct (replaces the earlier `ui-streamline-plan.md` draft).
**Built 29 Oct**, with one change Jack asked for while it was being built: the
**client list stays in the sidebar**, under the five sections, so a client is
one click away.

## In plain English

Beacon is arranged around the order the work happens:

**Agents gather → Inbox you review → Library what we know → Clients who it affects**

- Sidebar: **Home · Agents · Inbox (n) · Library · Clients**, then the client
  list, with **Settings** pinned at the bottom.
- **Home** shows what needs you: inbox count, topics to approve, webinars on
  the shortlist, Library items that stopped, one line per agent, then tasks.
- **Library** (was Knowledge) holds everything learned, on tabs: **Topics**
  (the knowledge base), **Webinars & videos**, **Manuals** and **Pages**.
- **Clients** show what matters to each client: modules, release, hosting,
  and "Updates for this client" (the intel, opportunities and tasks that
  approved inbox items created).
- Briefs, Opportunities and Modules are **off the menu, not deleted**: their
  addresses still work, approval still creates them, and they show on clients.
- No explanatory paragraphs: clear names and buttons, one short line only on an
  empty screen. Errors, warnings, costs, the portal permission label and the
  checked/not-checked state stay.
- An agent is set up with three things (**Name, What to look for, Where to
  look**); everything else sits under a closed **Advanced**. Runs have their own
  tab.

## Writing rules (every screen)

1. No explanatory paragraphs. If a screen needs one, fix the label or layout.
2. Buttons say what happens: "Watch this webinar", "Approve", "Run now".
3. One short line on an empty screen only.
4. Keep errors, warnings, cost figures, the portal permission label, and
   checked/not-checked.
5. One word per idea:

| Use | Not |
|---|---|
| Inbox item | finding, research item |
| Library | knowledge, sources |
| Checked (source) | verified |
| Approve / Dismiss | fan-out, finalize |
| Run | job, execution |
| Topic | KB node, section |

Code names stay unchanged internally (`Finding`, `/research`): this is labels only.

## Where things went

| Was | Now |
|---|---|
| Test mode on /agents | Settings → Research (cost shown next to it) |
| Portal switch on /knowledge | Settings → Tagetik Community (+ signed-in status) |
| Product context on /modules | Settings → What Beacon should know about our firm |
| Module descriptions on /modules/[id] | Settings → Modules (click a module) |
| Opportunity categories on /opportunities | Settings → Opportunity categories |
| "Add a video" on the Inbox | Library → Webinars & videos |
| /knowledge, /knowledge/base | /library, /library?tab=topics (old links redirect) |
| Hand-entry forms on client pages | Client → Add by hand (closed) |

## Building blocks

`components/ui.tsx`: PageHeader, Tabs, StatusChip, EmptyState, SidePanel,
PanelBox, Advanced, Section. `lib/nav.ts` is the single list of sections
(asserted in `npm run test:docs`).
