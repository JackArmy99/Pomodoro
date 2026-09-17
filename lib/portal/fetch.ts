import { checkUrl, permittedLinks } from "@/lib/portal/allowlist";

// Reading a portal page: allowlisted, read-only, paced, capped and logged.
//
// The limits are here rather than in a prompt because a prompt is advice and
// this needs to be a rule. Pushback from the site (429 or 403) stops the run —
// being blocked is an answer about whether we should be doing this, not an
// obstacle to work around.

export const PAGE_DELAY_MS = 2000; // between pages, deliberately unhurried
export const DEFAULT_PAGE_CAP = 25; // per run

export type FetchLogEntry = {
  url: string;
  at: string;
  status: number | null;
  outcome: "fetched" | "refused" | "blocked" | "error" | "would-fetch";
  note?: string;
};

export type PageResult = {
  url: string;
  title: string;
  text: string;
  links: string[];
};

export class Blocked extends Error {}
export class CapReached extends Error {}

export type Reader = {
  pages: PageResult[];
  log: FetchLogEntry[];
  read(url: string): Promise<PageResult | null>;
};

type Ctx = {
  // A minimal browser-page interface, so this is testable without a browser.
  goto(url: string): Promise<{ status: number | null }>;
  content(): Promise<{ title: string; text: string; links: string[] }>;
  wait?(ms: number): Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createReader(
  ctx: Ctx,
  opts: { cap?: number; dryRun?: boolean; delayMs?: number } = {},
): Reader {
  const cap = opts.cap ?? DEFAULT_PAGE_CAP;
  const delayMs = opts.delayMs ?? PAGE_DELAY_MS;
  const pages: PageResult[] = [];
  const log: FetchLogEntry[] = [];
  let fetched = 0;
  let first = true;

  const note = (
    url: string,
    outcome: FetchLogEntry["outcome"],
    status: number | null,
    detail?: string,
  ) => {
    log.push({ url, at: new Date().toISOString(), status, outcome, note: detail });
  };

  return {
    pages,
    log,
    async read(raw: string) {
      const check = checkUrl(raw);
      if (!check.ok) {
        note(raw, "refused", null, check.reason);
        return null;
      }
      const url = check.url.toString();

      if (opts.dryRun) {
        note(url, "would-fetch", null, "dry run — nothing was retrieved");
        return null;
      }

      if (fetched >= cap) {
        note(url, "refused", null, `page cap of ${cap} reached`);
        throw new CapReached(
          `Stopped after ${cap} pages. Raise the cap deliberately if you need more.`,
        );
      }

      // Pace between pages, not before the first one.
      if (!first) await (ctx.wait ? ctx.wait(delayMs) : sleep(delayMs));
      first = false;

      let status: number | null = null;
      try {
        ({ status } = await ctx.goto(url));
      } catch (err: any) {
        note(url, "error", null, String(err?.message ?? err).slice(0, 200));
        return null;
      }

      if (status === 429 || status === 403) {
        note(url, "blocked", status, "the site pushed back");
        throw new Blocked(
          status === 429
            ? "The portal is rate-limiting us. Stopping — try again later, more slowly."
            : "The portal refused access (403). Stopping rather than trying to get around it.",
        );
      }

      if (status && status >= 400) {
        note(url, "error", status, "page not available");
        return null;
      }

      const { title, text, links } = await ctx.content();
      fetched++;
      note(url, "fetched", status);

      const page: PageResult = {
        url,
        title,
        text,
        links: permittedLinks(links, url),
      };
      pages.push(page);
      return page;
    },
  };
}
