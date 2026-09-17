import { openContext } from "@/lib/portal/session";

// A real browser page behind the same tiny interface the guardrails are tested
// against. `lib/portal/fetch.ts` defines `goto` / `content` / `wait` precisely
// so pacing, caps, logging and the 429/403 abort could be proven without a
// browser — this adapter changes none of that, it just supplies real pages.

export type BrowserSession = {
  ctx: {
    goto(url: string): Promise<{ status: number | null }>;
    content(): Promise<{ title: string; text: string; links: string[] }>;
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
          return { title: document.title ?? "", text, links };
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
