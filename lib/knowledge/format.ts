// Plain-English labels for job state and acquisition failures. The user should
// never see a raw code, and never "Nothing new" for a failed retrieval.
export const JOB_STATE_LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Processing…",
  retry_wait: "Retrying…",
  needs_input: "Needs your input",
  succeeded: "Ready",
  partial: "Partly done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const JOB_STATE_STYLES: Record<string, string> = {
  queued: "border-slate-200 bg-slate-100 text-slate-600",
  running: "border-indigo-200 bg-indigo-50 text-indigo-700",
  retry_wait: "border-amber-200 bg-amber-50 text-amber-800",
  needs_input: "border-amber-200 bg-amber-50 text-amber-800",
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-700",
  partial: "border-amber-200 bg-amber-50 text-amber-800",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  cancelled: "border-slate-200 bg-slate-100 text-slate-500",
};

export const STAGE_LABELS: Record<string, string> = {
  metadata: "Reading video details",
  captions: "Fetching the transcript",
  store: "Storing the transcript",
  summarise: "Summarising",
  finding: "Adding to the inbox",
  published: "Done",
  // document import
  read: "Reading the file",
  compare: "Comparing with the last version",
  fetch: "Reading the page",
};

export function errorAdvice(code: string | null, message: string | null): string {
  switch (code) {
    case "captions_disabled":
      return "Captions are turned off for this video, so there's no transcript to read. Nothing was analysed.";
    case "captions_not_available":
      return "This video has no caption track. Automatic transcription isn't part of this version yet.";
    case "video_unavailable":
      return "The video is private, deleted or otherwise unavailable.";
    case "rate_limited":
      return "YouTube is rate-limiting this machine. Wait a few minutes and retry.";
    case "video_or_network":
      return "Couldn't load this video. It may be private or deleted — or this machine couldn't reach YouTube (proxy, VPN or no connection). Open the link in your browser to check, then retry.";
    case "no_api_key":
      return "There's no ANTHROPIC_API_KEY set, so there was nothing to summarise with. The transcript is stored in full — add the key and summarise again.";
    case "bad_json":
      return "The model's summary came back malformed. Nothing was lost — press Summarise again.";
    case "no_valid_points":
      return "The summary couldn't be traced back to the transcript, so it was discarded rather than shown with timestamps that go nowhere. Try again.";
    case "truncated":
      return "The notes ran longer than the reply limit and were cut off. Press Summarise again; if it keeps happening on the same video, tell Claude — it may need splitting into sections.";
    case "no_text":
      return "No text could be read from that file. If it's a scan of paper rather than a digital document, reading it needs OCR — not in this version.";
    case "old_word_format":
      return "Old .doc files aren't supported. Open it in Word, save as .docx, and upload again.";
    case "unreadable":
      return message ?? "That file couldn't be read.";
    case "file_missing":
      return "The uploaded file is no longer on disk. Upload it again.";
    case "portal_disabled":
      return "Portal access is switched off. Turn it on from the Knowledge page — that switch is your confirmation that automated access is allowed under your Wolters Kluwer agreement.";
    case "no_session":
      return "No saved portal session yet. Run:  npm run portal:login";
    case "session_expired":
      return "The portal session has expired. Run:  npm run portal:login";
    case "dry_run":
      return "Dry run — nothing was retrieved. The pages it would read are listed below. Untick 'dry run' to store the page.";
    case "blocked":
      return message ?? "The portal pushed back, so the run stopped rather than trying to get around it.";
    case "page_cap":
      return message ?? "Stopped at the page limit for one run.";
    case "refused":
      return message ?? "That address isn't on the allowed list.";
    case "no_browser":
      return message ?? "The browser isn't installed. Run:  npm run portal:setup";
    case "no_version":
      return "There's no stored transcript for this video yet.";
    case "network_error":
      return `Couldn't reach YouTube: ${message ?? "network error"}.`;
    default:
      return message ?? "Something went wrong.";
  }
}
