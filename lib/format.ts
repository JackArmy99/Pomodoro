// Small display helpers shared across the app.

export const SOURCE_TYPES = [
  "manual",
  "rss",
  "newsletter",
  "video",
  "portal",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  rss: "Blog / RSS",
  newsletter: "Newsletter",
  video: "Video",
  portal: "Portal",
};

export const STAGES = ["open", "pursuing", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<string, string> = {
  open: "Open",
  pursuing: "Pursuing",
  won: "Won",
  lost: "Lost",
};

export const STAGE_STYLES: Record<string, string> = {
  open: "bg-slate-100 text-slate-700 border-slate-200",
  pursuing: "bg-amber-100 text-amber-800 border-amber-200",
  won: "bg-emerald-100 text-emerald-800 border-emerald-200",
  lost: "bg-rose-100 text-rose-700 border-rose-200",
};

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Parse a value from an <input type="date"> (or empty string) into a Date | null.
export function parseDate(value: FormDataEntryValue | null): Date | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Parse an optional integer field from a form.
export function parseInt0(value: FormDataEntryValue | null): number | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

export function formatMoney(value: number | null | undefined): string {
  if (value == null) return "";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}
