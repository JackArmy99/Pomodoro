// The Tagetik Community Library, read as a LIST of items — never diffed as
// text. Jack chooses what Beacon watches: the Library's own Asset Type filter
// narrows it (Webinars first), then he ticks items from a shortlist. Nothing
// is downloaded until he does.
//
// Real shape, captured 16 Oct 2026 — each item's lines read:
//   "video" / "Watch"            (or "60.6 MB | pdf" / "Download")
//   "Webinars | September 16, 2026"
//   "<title>"
//   "<description…>"
//   "Read More"
// with a link to the item's own page, /library…/<slug>.

// The Library's own filter: Asset Type = Webinars (238 items on 16 Oct 2026,
// first page 15/15 webinars). Newest first.
export const WEBINARS_URL =
  "https://community.tagetik.com/library?asset_type=webinars&sort_on=upload_date%3Adescending";

export type LibraryItem = {
  key: string; // host + path of the item's page: the identity used everywhere
  url: string; // the item's own page
  category: string; // "Webinars"
  dateText: string; // "September 16, 2026"
  date: string | null; // ISO, when parseable
  title: string;
  description: string;
};

const DATE_LINE = /^(.+?)\s+\|\s+([A-Z][a-z]+ \d{1,2}, \d{4})$/;

// The identity of a Library item: its page's host + path, no query or anchor.
// The SAME key enqueuePortalVideo() uses, so "already watched" is one lookup
// whichever way an item arrived (pasted by Jack, or ticked on the shortlist).
export function libraryKey(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!/(^|\.)community\.tagetik\.com$/i.test(u.hostname)) return null;
    if (!/^\/library[^/]*\/[^/]+/.test(u.pathname)) return null;
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, "").slice(0, 200);
  } catch {
    return null;
  }
}

export function parseListing(raw: { lines: string[]; links: string[] }[]): LibraryItem[] {
  const out: LibraryItem[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const at = item.lines.findIndex((l) => DATE_LINE.test(l));
    if (at < 0) continue;
    const [, category, dateText] = DATE_LINE.exec(item.lines[at])!;
    const title = item.lines[at + 1] ?? "";
    const rest = item.lines.slice(at + 2);
    const end = rest.findIndex((l) => /^read more$/i.test(l));
    const description = (end >= 0 ? rest.slice(0, end) : rest).join(" ").trim();

    // The item's own page — not the "@download" file link.
    const page = item.links.find((h) => !/@download/.test(h) && libraryKey(h));
    if (!page || !title) continue;
    const key = libraryKey(page)!;
    if (seen.has(key)) continue;
    seen.add(key);

    const parsed = new Date(`${dateText} 12:00 UTC`);
    out.push({
      key,
      url: page.split(/[?#]/)[0],
      category: category.trim(),
      dateText,
      date: Number.isNaN(parsed.getTime()) ? null : parsed.toISOString(),
      title,
      description,
    });
  }
  return out;
}

// Items Jack said "not interested" to. Kept as a Setting so a dismissed
// webinar is never offered again, without needing a new table.
export const DISMISSED_KEY = "library_dismissed";
