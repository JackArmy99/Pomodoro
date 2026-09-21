import { openContext } from "@/lib/portal/session";

// A real browser page behind the same tiny interface the guardrails are tested
// against. `lib/portal/fetch.ts` defines `goto` / `content` / `wait` precisely
// so pacing, caps, logging and the 429/403 abort could be proven without a
// browser — this adapter changes none of that, it just supplies real pages.

export type StructureSample = {
  container: { tag: string; className: string; childCount: number } | null;
  items: {
    tag: string;
    className: string;
    text: string;
    links: { href: string; text: string }[];
  }[];
};

export type BrowserSession = {
  ctx: {
    goto(url: string): Promise<{ status: number | null }>;
    content(): Promise<{
      title: string;
      text: string;
      links: string[];
      embeds: string[];
    }>;
    // Optional: only a listing page needs its structure sampled.
    sample?(): Promise<StructureSample>;
  };
  signedOut(): Promise<boolean>;
  close(): Promise<void>;
};

export async function openBrowser(): Promise<BrowserSession> {
  const context = await openContext({ headed: false });
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    ctx: {
      async goto(url: string) {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        return { status: response?.status() ?? null };
      },
      async content() {
        // innerText, not the HTML: what a person actually sees on the page,
        // with navigation chrome and scripts left out.
        return page.evaluate(() => {
          const text = (document.body as HTMLElement)?.innerText ?? "";
          const links = Array.from(document.querySelectorAll("a[href]")).map(
            (a) => (a as HTMLAnchorElement).getAttribute("href") ?? "",
          );
          // A "Watch" button is often not a link at all — the video sits in an
          // iframe or a <video> tag. Collect those separately, or the one thing
          // worth knowing about a webinar page is invisible.
          const embeds = Array.from(
            document.querySelectorAll("iframe[src], video[src], video source[src]"),
          )
            .map((el) => el.getAttribute("src") ?? "")
            .filter(Boolean);
          return { title: document.title ?? "", text, links, embeds };
        });
      },
      // A listing page is a repeated structure, and a parser written against
      // markup nobody has looked at is a scraper that breaks silently. This
      // samples the repeating blocks so the parser can be written against what
      // is really there.
      async sample() {
        return page.evaluate(() => {
          // Find the element whose children look most like a list of items:
          // several siblings, each containing a link and some text.
          function score(el: Element): number {
            const kids = Array.from(el.children);
            if (kids.length < 3) return 0;
            const withLinks = kids.filter(
              (k) => k.querySelector("a[href]") && (k as HTMLElement).innerText?.trim(),
            );
            return withLinks.length >= 3 ? withLinks.length : 0;
          }

          let best: Element | null = null;
          let bestScore = 0;
          for (const el of Array.from(document.querySelectorAll("body *"))) {
            const s = score(el);
            if (s > bestScore) {
              bestScore = s;
              best = el;
            }
          }
          if (!best) return { container: null, items: [] };

          const items = Array.from(best.children)
            .slice(0, 6)
            .map((k) => {
              const el = k as HTMLElement;
              const anchors = Array.from(k.querySelectorAll("a[href]")).map((a) => ({
                href: (a as HTMLAnchorElement).href,
                text: (a as HTMLElement).innerText?.trim().slice(0, 120) ?? "",
              }));
              return {
                className: el.className?.toString().slice(0, 200) ?? "",
                tag: el.tagName.toLowerCase(),
                text: el.innerText?.trim().slice(0, 600) ?? "",
                links: anchors.slice(0, 6),
              };
            });

          return {
            container: {
              tag: (best as HTMLElement).tagName.toLowerCase(),
              className: (best as HTMLElement).className?.toString().slice(0, 200) ?? "",
              childCount: best.children.length,
            },
            items,
          };
        });
      },
    },
    // A visible password box means the session has expired and we are looking
    // at a sign-in page rather than the content behind it.
    async signedOut() {
      try {
        return (await page.locator('input[type="password"]:visible').count()) > 0;
      } catch {
        return false;
      }
    },
    async close() {
      await context.close();
    },
  };
}
