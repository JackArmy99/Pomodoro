import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";

// ---------------------------------------------------------------------------
// Captions-first acquisition. Unlike the old helper this keeps every cue WITH
// its timing (they are what summary points cite) and reports *why* a fetch
// failed instead of collapsing everything to "no captions".
// ---------------------------------------------------------------------------

export type VideoIdentity = { videoId: string; canonicalUrl: string };

// Why acquisition failed. Each maps to different advice in the UI, so we never
// tell the user "no captions" when the video was actually private or we were
// rate-limited.
export type AcquireErrorCode =
  | "captions_disabled"
  | "captions_not_available"
  | "video_unavailable"
  | "rate_limited"
  | "network_error";

export type Cue = { ordinal: number; startMs: number; endMs: number; text: string };

export type AcquireResult =
  | { ok: true; cues: Cue[]; language: string | null }
  | { ok: false; code: AcquireErrorCode; message: string };

const ID = /^[A-Za-z0-9_-]{11}$/;

// Accept the URL forms a person actually pastes; reject anything that isn't a
// single public video. Identity is the video id alone, so tracking params and
// `t=` jumps can't create duplicate sources.
export function canonicaliseYouTubeUrl(input: string): VideoIdentity | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return ID.test(raw) ? id(raw) : null; // a bare video id is fine
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null; // embedded credentials

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.replace(/\/+$/, "");

  // A playlist link without a single video is ambiguous — refuse it.
  if (path === "/playlist") return null;

  if (host === "youtu.be") return maybe(path.slice(1));
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (path === "/watch") return maybe(url.searchParams.get("v") ?? "");
    for (const prefix of ["/shorts/", "/embed/", "/live/", "/v/"]) {
      if (path.startsWith(prefix)) return maybe(path.slice(prefix.length).split("/")[0]);
    }
  }
  return null;
}

function maybe(candidate: string): VideoIdentity | null {
  return ID.test(candidate) ? id(candidate) : null;
}

function id(videoId: string): VideoIdentity {
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

// Deep-link straight to the moment a cue starts.
export function timestampUrl(canonicalUrl: string, startMs: number): string {
  return `${canonicalUrl}&t=${Math.max(0, Math.floor(startMs / 1000))}s`;
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Fetch the whole caption track as ordered, timed cues. No truncation.
export async function acquireCaptions(videoId: string): Promise<AcquireResult> {
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId);
    if (!raw.length) {
      return {
        ok: false,
        code: "captions_not_available",
        message: "The caption track came back empty.",
      };
    }
    const cues: Cue[] = raw.map((r, i) => {
      const startMs = Math.round(r.offset);
      return {
        ordinal: i + 1,
        startMs,
        endMs: startMs + Math.round(r.duration),
        text: r.text.replace(/\s+/g, " ").trim(),
      };
    });
    return {
      ok: true,
      cues: cues.filter((c) => c.text.length > 0),
      language: raw[0]?.lang ?? null,
    };
  } catch (err) {
    return { ok: false, ...classify(err) };
  }
}

function classify(err: unknown): { code: AcquireErrorCode; message: string } {
  if (err instanceof YoutubeTranscriptTooManyRequestError)
    return {
      code: "rate_limited",
      message: "YouTube is rate-limiting this machine. Try again later.",
    };
  if (err instanceof YoutubeTranscriptVideoUnavailableError)
    return {
      code: "video_unavailable",
      message: "The video is private, deleted or unavailable.",
    };
  if (err instanceof YoutubeTranscriptDisabledError)
    return {
      code: "captions_disabled",
      message: "Captions are turned off for this video.",
    };
  if (
    err instanceof YoutubeTranscriptNotAvailableError ||
    err instanceof YoutubeTranscriptNotAvailableLanguageError
  )
    return {
      code: "captions_not_available",
      message: "This video has no caption track available.",
    };
  return {
    code: "network_error",
    message: err instanceof Error ? err.message.slice(0, 200) : "Network error.",
  };
}

// Title/channel via the public oEmbed endpoint — no API key, no scraping.
// `status` is the HTTP status (null if the request threw). Only a 200 proves we
// actually reached YouTube: a corporate proxy or VPN that blocks the request can
// answer with its own error page, which looks like a response but isn't YouTube.
export async function fetchMetadata(canonicalUrl: string): Promise<{
  status: number | null;
  title: string;
  channel: string | null;
}> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`,
    );
    if (!res.ok) return { status: res.status, title: "YouTube video", channel: null };
    const json = (await res.json()) as { title?: string; author_name?: string };
    return {
      status: 200,
      title: json.title?.slice(0, 300) || "YouTube video",
      channel: json.author_name?.slice(0, 200) ?? null,
    };
  } catch {
    return { status: null, title: "YouTube video", channel: null };
  }
}
