// How much a source is allowed to say in the knowledge base.
//
// Manuals are the backbone: only a tier-1 source can create, change or
// replace a manual statement. Everything else (release notes, webinars,
// marketing, news, forum posts) can only ADD labelled supplementary
// statements. That is a rule in code, not a prompt — see
// docs/knowledge-base-plan.md, "Source authority".
//
// The tier is always derived from docType here, never typed in, so the two
// can't disagree. A source with no docType is treated as the LOWEST tier: an
// unclassified upload must never be mistaken for a manual.

export const DOC_TYPES = [
  { value: "manual", label: "Manual", tier: 1 },
  { value: "release_notes", label: "Release notes", tier: 2 },
  { value: "official", label: "Other official doc", tier: 2 },
  { value: "webinar", label: "Webinar / demo", tier: 3 },
  { value: "promotional", label: "White paper / e-book / marketing", tier: 4 },
  { value: "news", label: "News", tier: 5 },
  { value: "community", label: "Community post", tier: 5 },
] as const;

export type DocType = (typeof DOC_TYPES)[number]["value"];

export const LOWEST_TIER = 5;

export function isDocType(value: unknown): value is DocType {
  return DOC_TYPES.some((d) => d.value === value);
}

export function authorityFor(docType: string | null | undefined): number {
  return DOC_TYPES.find((d) => d.value === docType)?.tier ?? LOWEST_TIER;
}

export function docTypeLabel(docType: string | null | undefined): string {
  return DOC_TYPES.find((d) => d.value === docType)?.label ?? "Not classified";
}

// Only a manual may write manual statements.
export function isManualTier(authority: number | null | undefined): boolean {
  return authority === 1;
}

// What a source is when nobody has said otherwise. Videos and watched pages
// can be guessed from where they came from; an uploaded file can't (it might
// be a manual or a brochure), so it stays unclassified until Jack picks.
export function defaultDocType(kind: string): DocType | null {
  if (kind === "youtube" || kind === "portal_video") return "webinar";
  if (kind === "page") return "community";
  return null;
}

// docType + authority as they are written to a KnowledgeSource.
export function classification(docType: string | null | undefined): {
  docType: DocType | null;
  authority: number;
} {
  const t = isDocType(docType) ? docType : null;
  return { docType: t, authority: authorityFor(t) };
}

// A Tagetik release as Jack types it ("2025", "2026 SP1"). Free text on
// purpose — the format varies — but tidied, and "unknown"/blank mean not known.
export function normaliseRelease(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!s || /^(unknown|n\/?a|-+|—)$/i.test(s)) return null;
  return s;
}

// Suggested in the release boxes; anything else can still be typed.
export const RELEASE_SUGGESTIONS = ["2023", "2024", "2025", "2026", "SaaS (current)"];
