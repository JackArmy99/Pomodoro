import { openContext, looksLikeLoginUrl } from "@/lib/portal/session";

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

// Runs inside the page. Plain ES5-style JavaScript in a string so no build
// step can inject helpers into it (see sample() below). It finds the element
// whose children look most like a list — several siblings, each with a link
// and some text — and describes the first six.
export const SAMPLE_SCRIPT = `(() => {
  function score(el) {
    var kids = Array.from(el.children);
    if (kids.length < 3) return 0;
    var withLinks = kids.filter(function (k) {
      return k.querySelector("a[href]") && (k.innerText || "").trim();
    });
    return withLinks.length >= 3 ? withLinks.length : 0;
  }
  var best = null, bestScore = 0;
  Array.from(document.querySelectorAll("body *")).forEach(function (el) {
    var s = score(el);
    if (s > bestScore) { bestScore = s; best = el; }
  });
  if (!best) return { container: null, items: [] };
  var items = Array.from(best.children).slice(0, 6).map(function (k) {
    var anchors = Array.from(k.querySelectorAll("a[href]")).map(function (a) {
      return { href: a.href, text: (a.innerText || "").trim().slice(0, 120) };
    });
    return {
      className: String(k.className || "").slice(0, 200),
      tag: k.tagName.toLowerCase(),
      text: (k.innerText || "").trim().slice(0, 600),
      links: anchors.slice(0, 6)
    };
  });
  return {
    container: {
      tag: best.tagName.toLowerCase(),
      className: String(best.className || "").slice(0, 200),
      childCount: best.children.length
    },
    items: items
  };
})()`;

// The items on a Library listing page, raw: each item's text lines and links.
// Written against the real markup (captured 16 Oct 2026): a
// `div.infinite-scroll-component` holding one `div.container` per asset. A
// string for the same reason as SAMPLE_SCRIPT. lib/portal/library.ts turns
// this into titles, dates and links.
export const LISTING_SCRIPT = `(() => {
  var items = Array.from(document.querySelectorAll(".infinite-scroll-component > .container"));
  return items.map(function (el) {
    return {
      lines: (el.innerText || "").split("\\n").map(function (l) { return l.trim(); }).filter(Boolean),
      links: Array.from(el.querySelectorAll("a[href]")).map(function (a) { return a.href; })
    };
  });
})()`;

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
    // Optional: the raw items of a Library listing page.
    listing?(): Promise<{ lines: string[]; links: string[] }[]>;
  };
  // Fetch one file with the signed-in session (webinar MP4s need it). The
  // caller has already passed the URL through checkUrl(); this re-checks size
  // with a HEAD request BEFORE downloading, so an oversized file is refused
  // without spending the bandwidth.
  download(
    url: string,
    dest: string,
    maxBytes: number,
  ): Promise<{ ok: true; bytes: number } | { ok: false; status: number | null; reason: string }>;
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
        // The Community site is a JavaScript app: the first HTML says "Please
        // wait" and the real content (or a redirect to the login page) arrives
        // a moment later. Reading at "domcontentloaded" captured the loader and
        // nothing else. Wait for the network to go quiet, capped so a page that
        // never settles (live chat, analytics polling) can't stall a run.
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
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
        // Passed as a STRING, deliberately. When this file runs under tsx (the
        // worker), the compiler wraps named functions in a `__name(...)` helper
        // that exists in Node but not in the page — so the old function form
        // threw "__name is not defined" inside the browser, the caller's
        // .catch() turned that into null, and the structure panel silently
        // never appeared on any preview. A string is sent to the page verbatim.
        return page.evaluate(SAMPLE_SCRIPT) as Promise<StructureSample>;
      },
      async listing() {
        return page.evaluate(LISTING_SCRIPT) as Promise<{ lines: string[]; links: string[] }[]>;
      },
    },
    // Are we looking at the sign-in page instead of the content behind it?
    // An expired session on the Community site REDIRECTS to /auth/login, so
    // the address is the surest sign; a visible password box is the fallback
    // for any portal that shows the form in place.
    async signedOut() {
      if (looksLikeLoginUrl(page.url())) return true;
      try {
        return (await page.locator('input[type="password"]:visible').count()) > 0;
      } catch {
        return false;
      }
    },
    async download(url, dest, maxBytes) {
      const headers = { Referer: "https://community.tagetik.com/" };
      const head = await context.request.head(url, { headers, timeout: 30_000 });
      if (head.status() === 429 || head.status() === 403) {
        return { ok: false, status: head.status(), reason: "the site pushed back" };
      }
      const size = Number(head.headers()["content-length"] ?? 0);
      if (size > maxBytes) {
        return {
          ok: false,
          status: head.status(),
          reason: `${(size / 1048576).toFixed(0)} MB is over the ${(maxBytes / 1048576).toFixed(0)} MB limit`,
        };
      }
      const res = await context.request.get(url, { headers, timeout: 600_000 });
      if (!res.ok()) return { ok: false, status: res.status(), reason: `download failed (${res.status()})` };
      const body = await res.body();
      if (body.byteLength > maxBytes) {
        return { ok: false, status: res.status(), reason: "the file was larger than its size said" };
      }
      const { writeFileSync } = await import("node:fs");
      writeFileSync(dest, body);
      return { ok: true, bytes: body.byteLength };
    },
    async close() {
      await context.close();
    },
  };
}
