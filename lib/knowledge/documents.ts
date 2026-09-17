import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Turning a manual into the same shape as a transcript, so everything already
// built for video works on documents: stored in full, cited, diffable.
//
// Nothing here calls a model. Importing a 300-page manual is local work and
// costs nothing, however long it is — the model is only involved later, when a
// question is asked or a version changes.
//
// The unit of storage is a PARAGRAPH carrying its page number. Paragraphs give
// a diff that can name exactly which sentence was reworded; the page number is
// what a person actually wants quoted back at them.
// ---------------------------------------------------------------------------

export type DocPage = { num: number; text: string };
export type DocSegment = {
  ordinal: number;
  page: number;
  text: string;
};

export type ExtractResult =
  | { ok: true; pages: DocPage[]; pageCount: number; unit: "page" | "section" }
  | { ok: false; code: string; message: string };

// Word files and plain text have no pages, so they are blocked into sections of
// roughly this size. Labelled "section" rather than "page" so a citation never
// claims a page number the document does not have.
const CHARS_PER_SECTION = 3000;

function blockIntoSections(text: string): DocPage[] {
  const paragraphs = splitParagraphs(text);
  const pages: DocPage[] = [];
  let current: string[] = [];
  let size = 0;

  for (const para of paragraphs) {
    current.push(para);
    size += para.length;
    if (size >= CHARS_PER_SECTION) {
      pages.push({ num: pages.length + 1, text: current.join("\n\n") });
      current = [];
      size = 0;
    }
  }
  if (current.length) pages.push({ num: pages.length + 1, text: current.join("\n\n") });
  return pages;
}

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter((p) => p.length > 0);
}

// Extract page text from a file buffer. Runs server-side only.
export async function extractPages(
  name: string,
  buffer: Buffer,
): Promise<ExtractResult> {
  const lower = (name || "").toLowerCase();

  try {
    if (lower.endsWith(".pdf")) {
      const mod: any = await import("pdf-parse");
      const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        const pages: DocPage[] = (result?.pages ?? [])
          .map((p: any) => ({ num: Number(p.num), text: String(p.text ?? "") }))
          .filter((p: DocPage) => p.text.trim().length > 0);

        if (pages.length === 0) {
          return {
            ok: false,
            code: "no_text",
            message:
              "No text could be read from this PDF. It may be a scan of paper rather than a digital document — reading those needs OCR, which this version does not do.",
          };
        }
        return { ok: true, pages, pageCount: pages.length, unit: "page" };
      } finally {
        await parser.destroy?.();
      }
    }

    if (lower.endsWith(".docx")) {
      const mod: any = await import("mammoth");
      const extractRawText = mod.extractRawText ?? mod.default?.extractRawText;
      const result = await extractRawText({ buffer });
      const text = String(result?.value ?? "").trim();
      if (!text) {
        return { ok: false, code: "no_text", message: "That Word file has no readable text." };
      }
      const pages = blockIntoSections(text);
      return { ok: true, pages, pageCount: pages.length, unit: "section" };
    }

    if (lower.endsWith(".doc")) {
      return {
        ok: false,
        code: "old_word_format",
        message:
          "Old .doc files aren't supported. Open it in Word and save as .docx, then try again.",
      };
    }

    const text = buffer.toString("utf8").trim();
    if (!text) {
      return { ok: false, code: "no_text", message: "That file appears to be empty." };
    }
    return {
      ok: true,
      pages: blockIntoSections(text),
      pageCount: 0,
      unit: "section",
    };
  } catch (err: any) {
    return {
      ok: false,
      code: "unreadable",
      message: `Couldn't read that file: ${String(err?.message ?? err).slice(0, 200)}`,
    };
  }
}

// Pages -> paragraph segments, each remembering the page it came from.
export function toSegments(pages: DocPage[]): DocSegment[] {
  const segments: DocSegment[] = [];
  for (const page of pages) {
    for (const text of splitParagraphs(page.text)) {
      segments.push({ ordinal: segments.length, page: page.num, text });
    }
  }
  return segments;
}

export function contentHash(segments: DocSegment[]): string {
  return createHash("sha256")
    .update(segments.map((s) => `${s.page}:${s.text}`).join("\n"))
    .digest("hex");
}

// A stable identity for the DOCUMENT, not the bytes — so uploading a revised
// manual with the same name becomes a new version of the same source, which is
// what makes change detection possible at all.
export function documentKey(fileName: string): string {
  return (fileName || "document")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "document";
}
