// Reading a PDF manual properly: real paragraphs, no running headers, and the
// manual's own table of contents. Free — no model call.
//
// pdf-parse returns each page as one block with no blank lines, so a page of
// four sections became ONE "paragraph": citations could only say "page 15",
// and the running footer ("… August 2026 | © 2026 …") sat inside every page,
// so a new edition with a new date would have shown every page as changed.
// PDF.js gives each run of text with its position and size, which is enough to
// rebuild lines, break paragraphs where the spacing or the type size changes,
// and drop lines that repeat in the top/bottom margin on many pages.

export type PdfPage = { num: number; text: string };

export type OutlineEntry = {
  title: string;
  level: number; // 1 = top level
  page: number | null; // physical page, 1-based (same numbering as segments)
};

export type PdfRead = { pages: PdfPage[]; outline: OutlineEntry[]; pageCount: number };

type Item = { str: string; x: number; y: number; w: number; h: number };
type Line = { y: number; h: number; text: string };

const TOP_BAND = 0.92; // above this fraction of the page height = header zone
const BOTTOM_BAND = 0.07; // below this = footer zone

async function loadPdfjs(): Promise<any> {
  // The legacy build runs in Node without a browser worker.
  return import("pdfjs-dist/legacy/build/pdf.mjs" as string);
}

export async function readPdf(buffer: Buffer): Promise<PdfRead> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
    isEvalSupported: false,
  }).promise;

  try {
    const raw: { num: number; height: number; lines: Line[] }[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      const items: Item[] = (content.items as any[])
        .filter((it) => typeof it.str === "string" && it.str.trim())
        .map((it) => ({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          w: it.width ?? 0,
          h: Math.abs(it.height || it.transform[3] || 10),
        }));
      raw.push({ num: n, height, lines: toLines(items) });
      page.cleanup?.();
    }

    const chrome = repeatingMarginLines(raw);
    const pages: PdfPage[] = raw.map((p) => {
      const body = p.lines.filter((l) => !isChrome(l, p.height, chrome));
      return { num: p.num, text: toParagraphs(body).join("\n\n") };
    });

    const outline = await readOutline(doc);
    return { pages: pages.filter((p) => p.text.trim()), outline, pageCount: doc.numPages };
  } finally {
    await doc.destroy?.();
  }
}

// Runs of text on (about) the same baseline become one line, left to right. A
// wide gap between runs is a table cell boundary, kept as " | ".
export function toLines(items: Item[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Item[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - it.y) < Math.max(2, row[0].h * 0.5)) row.push(it);
    else rows.push([it]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    for (const it of row) {
      const gap = it.x - end;
      if (text) text += gap > 15 ? " | " : gap > 1 && !/\s$/.test(text) ? " " : "";
      text += it.str;
      end = it.x + it.w;
    }
    return {
      y: row[0].y,
      h: Math.max(...row.map((r) => r.h)),
      text: text.replace(/\s+/g, " ").trim(),
    };
  });
}

// A new paragraph where the type size changes (a heading) or the gap between
// lines is clearly bigger than ordinary line spacing.
export function toParagraphs(lines: Line[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let prev: Line | null = null;
  for (const line of lines) {
    if (!line.text) continue;
    const breakHere =
      prev !== null &&
      (Math.abs(prev.h - line.h) > 1 || prev.y - line.y > Math.max(prev.h, line.h) * 1.6);
    if (breakHere && cur.length) {
      out.push(joinLines(cur));
      cur = [];
    }
    cur.push(line.text);
    prev = line;
  }
  if (cur.length) out.push(joinLines(cur));
  return out.filter(Boolean);
}

function joinLines(lines: string[]): string {
  // "recover-" + "data" -> "recover-data" is left to the diff's normaliser,
  // which already treats line-break hyphenation as no change.
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

// Margin lines that repeat (digits ignored, so "Page 7" = "Page 8") on many
// pages are running headers/footers. A lone page number always is.
function marginKey(text: string): string {
  // Page-number cells ("iv", "12") are dropped, so a front-matter footer with
  // roman numerals matches the same footer on numbered pages.
  return text
    .split(" | ")
    .filter((cell) => !/^\s*([\divxlc]{1,6})\s*$/i.test(cell))
    .join(" | ")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function inMargin(line: Line, height: number): boolean {
  return line.y > height * TOP_BAND || line.y < height * BOTTOM_BAND;
}

function repeatingMarginLines(raw: { height: number; lines: Line[] }[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of raw) {
    const seen = new Set<string>();
    for (const l of p.lines) if (inMargin(l, p.height)) seen.add(marginKey(l.text));
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  // 3 pages, not a share of the document: the top margin carries the CHAPTER
  // name, which repeats only for that chapter's pages. A short document (under
  // 6 pages) has too little to tell chrome from content, so nothing is dropped.
  const threshold = raw.length < 6 ? Infinity : 3;
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([k]) => k));
}

function isChrome(line: Line, height: number, chrome: Set<string>): boolean {
  if (!inMargin(line, height)) return false;
  return chrome.has(marginKey(line.text)) || /^[\divxlc]{1,6}$/i.test(line.text.trim());
}

// The bookmarks, flattened in reading order with their depth and page.
async function readOutline(doc: any): Promise<OutlineEntry[]> {
  const out: OutlineEntry[] = [];
  let tree: any[] | null = null;
  try {
    tree = await doc.getOutline();
  } catch {
    return out;
  }
  const walk = async (items: any[], level: number) => {
    for (const it of items) {
      out.push({ title: cleanTitle(it.title), level, page: await destPage(doc, it.dest) });
      if (it.items?.length) await walk(it.items, level + 1);
    }
  };
  if (tree) await walk(tree, 1);
  return out.filter((e) => e.title);
}

async function destPage(doc: any, dest: unknown): Promise<number | null> {
  try {
    let d: any = dest;
    if (typeof d === "string") d = await doc.getDestination(d);
    if (!Array.isArray(d) || d[0] == null) return null;
    if (typeof d[0] === "number") return d[0] + 1;
    return (await doc.getPageIndex(d[0])) + 1;
  } catch {
    return null;
  }
}

function cleanTitle(t: unknown): string {
  return String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}
