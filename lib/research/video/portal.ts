import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { checkUrl } from "@/lib/portal/allowlist";
import { createReader, Blocked, CapReached, type FetchLogEntry } from "@/lib/portal/fetch";
import { portalEnabled } from "@/lib/portal/enabled";
import { hasProfile } from "@/lib/portal/session";
import { transcribeFile, AsrUnavailable } from "@/lib/research/video/asr";
import type { Cue } from "@/lib/research/video/youtube";

// ---------------------------------------------------------------------------
// A Tagetik Community webinar → timed transcript, on this machine.
//
// What the page really is (found on Jack's laptop, 16 Oct 2026): the library
// page embeds `edit-video.tagetik.com/media/<slug>/embed_player`, which
// redirects to api.tagetik.com and serves a video.js player over a PLAIN MP4
// (no streaming manifest, no copy protection) — and no caption track. So the
// route is: page → player → MP4 → local speech-to-text. Every address passes
// the same allowlist as any other portal read, and every one is logged.
//
// Three pages at most per webinar (library page, player, plus a redirect),
// one file download, under a size cap. The downloaded video is deleted once
// transcribed: the transcript is the evidence, and the file can be fetched
// again if ever needed.
// ---------------------------------------------------------------------------

const MAX_VIDEO_MB = Number(process.env.PORTAL_MAX_VIDEO_MB || 1000);

export type PortalVideoResult =
  | {
      ok: true;
      cues: Cue[];
      language: string;
      title: string;
      description: string;
      log: FetchLogEntry[];
      note: string;
    }
  | { ok: false; code: string; message: string; log: FetchLogEntry[] };

// The player embedded in a Community library page.
export function pickPlayer(embeds: string[]): string | null {
  return (
    embeds.find((u) => /\/embed_player\b/.test(u)) ??
    embeds.find((u) => /(edit-video|api)\.tagetik\.com\/(video\/)?media\//.test(u)) ??
    null
  );
}

// The video file the player loads. One MP4 today; prefer the highest
// resolution if there are ever several, since audio is the same in each and
// the larger file is the one the site treats as canonical.
export function pickMediaFile(embeds: string[]): string | null {
  const files = embeds.filter((u) => /\.(mp4|m4a|mp3|webm)(\?|$)/i.test(u));
  if (!files.length) return null;
  const res = (u: string) => Number(/(\d{3,4})p/i.exec(decodeURIComponent(u))?.[1] ?? 0);
  return [...files].sort((a, b) => res(b) - res(a))[0];
}

// "Webinar: … | CCH Tagetik Community" → "Webinar: …"
export function cleanTitle(title: string): string {
  return title.replace(/\s*\|\s*CCH®?\s*Tagetik Community\s*$/i, "").trim();
}

// The description follows the title. The title appears twice (breadcrumb, then
// heading) and the breadcrumb is followed by the Library's own blurb, so take
// the LAST occurrence.
export function pageDescription(text: string, title: string): string {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const at = lines.lastIndexOf(title);
  const after = at >= 0 ? lines.slice(at + 1) : [];
  return after.find((l) => l.length > 40) ?? "";
}

type Session = {
  ctx: any;
  signedOut(): Promise<boolean>;
  download(url: string, dest: string, maxBytes: number): Promise<any>;
  close(): Promise<void>;
};

export async function acquirePortalVideo(
  pageUrl: string,
  opts: {
    step: (stage: "media" | "transcribe", note?: string) => Promise<void>;
    note: (text: string) => Promise<void>;
    workDir?: string;
    // Injected by tests: a fake browser and a fake transcriber.
    openBrowser?: () => Promise<Session>;
    transcribe?: typeof transcribeFile;
  },
): Promise<PortalVideoResult> {
  const log: FetchLogEntry[] = [];
  const stop = (code: string, message: string): PortalVideoResult => ({ ok: false, code, message, log });

  if (!(await portalEnabled())) {
    return stop(
      "portal_disabled",
      "Portal access is switched off. Turn it on from the Knowledge page to confirm automated access is permitted.",
    );
  }
  if (!hasProfile()) return stop("no_session", "No saved portal session. Run: npm run portal:login");

  await opts.step("media");
  let browser: Session;
  try {
    browser = await (opts.openBrowser
      ? opts.openBrowser()
      : import("@/lib/portal/browser").then((m) => m.openBrowser()));
  } catch (err: any) {
    return stop("no_browser", String(err?.message ?? err));
  }

  const workDir = opts.workDir ?? join(process.cwd(), "storage", "media");
  mkdirSync(workDir, { recursive: true });
  const file = join(workDir, `webinar-${Date.now()}.mp4`);

  try {
    // The page and the player: two allowlisted reads, paced and logged.
    const reader = createReader(browser.ctx, { cap: 3 });
    const page = await reader.read(pageUrl);
    log.push(...reader.log.splice(0));
    if (!page) return stop("fetch_failed", log[log.length - 1]?.note ?? "The webinar page could not be read.");
    if (await browser.signedOut()) {
      return stop(
        "session_expired",
        "The portal sent us to its login page — your saved session has expired. Run: npm run portal:login",
      );
    }

    const title = cleanTitle(page.title);
    const description = pageDescription(page.text, title);

    const player = pickPlayer(page.embeds);
    if (!player) {
      return stop(
        "no_player",
        "This page has no video player — it may not be a webinar, or the video is a link to another site.",
      );
    }
    const playerPage = await reader.read(player);
    log.push(...reader.log.splice(0));
    const mediaUrl = playerPage ? pickMediaFile(playerPage.embeds) : null;
    if (!mediaUrl) {
      return stop("no_media", "Found the player but not a video file inside it.");
    }

    // The file itself: same allowlist, then a size check before any download.
    const verdict = checkUrl(mediaUrl);
    if (!verdict.ok) {
      log.push({ url: mediaUrl, at: new Date().toISOString(), status: null, outcome: "refused", note: verdict.reason });
      return stop("refused", `The video file is on a site that isn't allowed: ${verdict.reason}`);
    }
    const got = await browser.download(mediaUrl, file, MAX_VIDEO_MB * 1048576);
    log.push({
      url: mediaUrl,
      at: new Date().toISOString(),
      status: got.ok ? 200 : got.status,
      outcome: got.ok ? "fetched" : got.status === 429 || got.status === 403 ? "blocked" : "error",
      note: got.ok ? `${(got.bytes / 1048576).toFixed(1)} MB video` : got.reason,
    });
    if (!got.ok) {
      const blocked = got.status === 429 || got.status === 403;
      return stop(blocked ? "blocked" : "download_failed", got.reason);
    }
    await opts.note(`${(got.bytes / 1048576).toFixed(1)} MB video downloaded`);
    await browser.close().catch(() => {});

    // Local speech-to-text — the slow part (~half the video's length).
    await opts.step("transcribe", "transcribing on this computer — roughly half the video's length");
    const transcribe = opts.transcribe ?? transcribeFile;
    const result = await transcribe(file);
    if (!result.cues.length) return stop("no_speech", "No speech was found in the video.");
    await opts.note(
      `${result.cues.length} lines from ${result.audioMinutes.toFixed(1)} min of audio in ` +
        `${Math.round(result.seconds / 60)} min (${result.model.split("/").pop()})`,
    );

    return {
      ok: true,
      cues: result.cues,
      language: "en",
      title,
      description,
      log,
      note: `Machine transcription (${result.model.split("/").pop()}), product names corrected from a glossary.`,
    };
  } catch (err: any) {
    if (err instanceof AsrUnavailable) return stop("no_asr", err.message);
    if (err instanceof Blocked) return stop("blocked", err.message);
    if (err instanceof CapReached) return stop("page_cap", err.message);
    throw err;
  } finally {
    await browser.close().catch(() => {});
    rmSync(file, { force: true });
  }
}
