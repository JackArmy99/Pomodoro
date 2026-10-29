import type { OutlineEntry } from "@/lib/knowledge/pdfText";

// A manual edition's table of contents, pinned to the paragraphs it covers.
// Pure and free: no database, no model. See docs/knowledge-base-plan.md §3.
//
// Two sources, in order of trust:
//   1. the PDF's bookmarks — the manual's real contents, with exact pages;
//   2. numbered headings ("3.2.1 Intercompany matching") found among the
//      stored paragraphs, for a PDF with no bookmarks.

export type Seg = { ordinal: number; page: number | null; text: string };

export type Section = {
  ordinal: number; // position in the outline
  path: string; // "3.2.1"
  title: string;
  level: number;
  page: number | null;
  startOrdinal: number | null;
  endOrdinal: number | null; // includes its subsections
  method: "bookmarks" | "headings";
};

// Lowercase letters and digits only, so "Clone DTP Window" matches
// "Clone DTP window" and stray punctuation doesn't matter.
// A leading section number is dropped first, because bookmarks and headings
// disagree about it ("Matching" vs "2.1 Matching").
export function titleKey(s: string): string {
  return s
    .replace(/^\s*\d{1,2}(?:\.\d{1,2}){0,4}\.?\s+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Bookmarks → sections. Levels are tidied so a child is never more than one
// level below its parent (some PDFs skip levels), and paths are numbered by
// position in the tree.
export function sectionsFromOutline(outline: OutlineEntry[], segs: Seg[]): Section[] {
  const entries = outline.filter((e) => e.title);
  const levels = tidyLevels(entries.map((e) => e.level));
  const paths = numberPaths(levels);
  const sections: Section[] = entries.map((e, i) => ({
    ordinal: i,
    path: paths[i],
    title: e.title,
    level: levels[i],
    page: e.page,
    startOrdinal: null,
    endOrdinal: null,
    method: "bookmarks",
  }));
  pin(sections, segs);
  return sections;
}

// Numbered headings → sections, for a PDF without bookmarks. A contents page
// lists the same numbers first, so when a number repeats, the LAST occurrence
// (the heading in the body) wins.
const HEADING = /^(\d{1,2}(?:\.\d{1,2}){0,4})\.?\s+(\S.{1,110})$/;

export function sectionsFromHeadings(segs: Seg[]): Section[] {
  const byPath = new Map<string, { title: string; seg: Seg }>();
  for (const seg of segs) {
    const text = seg.text.trim();
    if (text.length > 120) continue;
    const m = text.match(HEADING);
    if (!m) continue;
    const title = m[2].trim();
    // Contents-page lines end in a page number or dot leaders; headings don't.
    if (/(\.{3,}|\s\d{1,4})$/.test(title)) continue;
    if (!/^[A-Z]/.test(title)) continue;
    byPath.set(m[1], { title, seg });
  }
  const found = [...byPath.entries()]
    .map(([path, v]) => ({ path, ...v }))
    .sort((a, b) => a.seg.ordinal - b.seg.ordinal);

  const levels = tidyLevels(found.map((f) => f.path.split(".").length));
  const sections: Section[] = found.map((f, i) => ({
    ordinal: i,
    path: f.path,
    title: f.title,
    level: levels[i],
    page: f.seg.page,
    startOrdinal: f.seg.ordinal,
    endOrdinal: null,
    method: "headings",
  }));
  setEnds(sections, segs);
  return sections;
}

// Bookmarks if the PDF has them, else numbered headings, else nothing.
export function buildSections(outline: OutlineEntry[] | undefined, segs: Seg[]): Section[] {
  if (outline && outline.length > 0) {
    const s = sectionsFromOutline(outline, segs);
    if (s.length > 0) return s;
  }
  return sectionsFromHeadings(segs);
}

function tidyLevels(raw: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const prev = i === 0 ? 0 : out[i - 1];
    out.push(Math.max(1, Math.min(raw[i], prev + 1)));
  }
  return out;
}

function numberPaths(levels: number[]): string[] {
  const counters: number[] = [];
  return levels.map((lvl) => {
    counters.length = lvl;
    counters[lvl - 1] = (counters[lvl - 1] ?? 0) + 1;
    for (let k = 0; k < lvl - 1; k++) counters[k] = counters[k] ?? 1;
    return counters.join(".");
  });
}

// Find each section's first paragraph: its heading on its page when the title
// can be matched, otherwise the page's first paragraph.
function pin(sections: Section[], segs: Seg[]) {
  const byPage = new Map<number, Seg[]>();
  for (const s of segs) {
    if (s.page == null) continue;
    const list = byPage.get(s.page) ?? [];
    list.push(s);
    byPage.set(s.page, list);
  }
  let cursor = -1;
  for (const sec of sections) {
    if (sec.page == null) continue;
    const want = titleKey(sec.title);
    // The heading may sit on the bookmarked page or, when the bookmark points
    // at the bottom of a page, at the top of the next.
    const candidates = [...(byPage.get(sec.page) ?? []), ...(byPage.get(sec.page + 1) ?? [])];
    const matches = candidates.filter((s) => want && titleKey(s.text).startsWith(want));
    // Prefer the first heading match after the previous section (a page often
    // holds several sections, and two can share a title).
    const hit =
      matches.find((s) => s.ordinal > cursor) ??
      matches[0] ??
      (byPage.get(sec.page) ?? [])[0] ??
      segs.find((s) => (s.page ?? 0) >= sec.page!);
    if (hit) {
      sec.startOrdinal = hit.ordinal;
      cursor = Math.max(cursor, hit.ordinal);
    }
  }
  setEnds(sections, segs);
}

// A section runs until the next section at the same or a higher level, so a
// chapter's range covers all of its subsections.
function setEnds(sections: Section[], segs: Seg[]) {
  const last = segs.length ? segs[segs.length - 1].ordinal : null;
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.startOrdinal == null) continue;
    let end = last;
    for (let j = i + 1; j < sections.length; j++) {
      const next = sections[j];
      if (next.level <= sec.level && next.startOrdinal != null && next.startOrdinal > sec.startOrdinal) {
        end = next.startOrdinal - 1;
        break;
      }
    }
    sec.endOrdinal = end == null ? sec.startOrdinal : Math.max(sec.startOrdinal, end);
  }
}
