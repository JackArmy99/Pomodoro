// Extract plain text from an uploaded research brief — PDF, Word (.docx), or
// plain text. Runs server-side only (these libraries are Node-only).

export async function extractText(file: File): Promise<string> {
  const name = (file.name || "").toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".pdf")) {
    const mod: any = await import("pdf-parse");
    const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return String(result?.text ?? "").trim();
    } finally {
      await parser.destroy?.();
    }
  }

  if (name.endsWith(".docx")) {
    const mod: any = await import("mammoth");
    const extractRawText = mod.extractRawText ?? mod.default?.extractRawText;
    const result = await extractRawText({ buffer });
    return String(result?.value ?? "").trim();
  }

  // Anything else — treat as plain text.
  return buffer.toString("utf8").trim();
}
