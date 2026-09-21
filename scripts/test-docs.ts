import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { runDocumentJob } from "@/lib/knowledge/documentPipeline";
import { diffVersions, normalise } from "@/lib/knowledge/diff";
import { splitParagraphs, toSegments, documentKey } from "@/lib/knowledge/documents";
import { sourceView } from "@/lib/knowledge/format";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "beacon-doctest-"));
const dbPath = join(dir, "t.db");
let bad = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${d ? " — " + d : ""}`); if (!ok) bad++; };

const V1 = `The consolidation process begins with data collection.

Intercompany balances must be matched before elimination.

Currency translation uses the closing rate.`;

const V2 = `The consolidation process begins with data collection.

Intercompany balances must be reconciled and matched prior to elimination.

Currency translation uses the closing rate.

New in 2026: validation runs automatically on lock.`;

// Pure checks first — no database, no files, instant.
function diffGuards() {
  console.log("\nDiff guards");
  const seg = (o: number, page: number, text: string) => ({ ordinal: o, page, text });
  const a = [
    seg(0, 1, "Intercompany balances must be matched before elimination."),
    seg(1, 2, "Currency translation uses the closing rate."),
  ];
  const b = [
    seg(0, 1, "Intercompany balances must be reconciled and matched prior to elimination."),
    seg(1, 2, "Currency translation uses the closing rate."),
  ];
  const r = diffVersions(a, b);
  check("rewording is a CHANGE, not an add+remove", r.changes.length === 1 && r.changes[0].kind === "changed");
  check("the untouched paragraph is untouched", r.unchanged === 1);

  const cosmetic = a.map((s) => ({ ...s, text: s.text.replace(/ /g, "  ") }));
  check("whitespace churn is not a change", diffVersions(a, cosmetic).changes.length === 0);
  check("PDF hyphenation is normalised", normalise("elimin- ation") === normalise("elimination"));
  check("identical versions cost nothing to compare", diffVersions(a, a).changes.length === 0);

  const segs = toSegments([{ num: 1, text: "One.\n\nTwo." }, { num: 2, text: "Three." }]);
  check("segments number sequentially across pages", segs.map((s) => s.ordinal).join(",") === "0,1,2");
  check("segments keep their page", segs[2].page === 2);
  check("paragraphs split on blank lines", splitParagraphs("a\n\nb").length === 2);
  check("a revised file maps to the same document", documentKey("Manual v3.pdf") === documentKey("manual-v3.PDF"));
}

// What each kind of source claims to be. A web page once offered "Watch on
// YouTube" and a Transcript heading because video was the silent default, so
// each kind is asserted explicitly here rather than inferred from the others.
function sourceViewGuards() {
  console.log("\nSource page, by kind");

  const page = sourceView("page");
  check("a web page offers nothing to watch", page.showVideoLink === false);
  check("a web page has no cited summary", page.showSummary === false);
  check("a web page reads 'Contents', not 'Transcript'", page.contentsHeading === "Contents", page.contentsHeading);
  check("a web page counts paragraphs", page.unitWord === "paragraphs", page.unitWord);
  check("a web page shows what changed", page.showChanges === true);
  check("a web page is not a video", page.isVideo === false);

  const video = sourceView("youtube");
  check("a video links to YouTube", video.showVideoLink === true);
  check("a video shows its summary", video.showSummary === true);
  check("a video reads 'Transcript'", video.contentsHeading === "Transcript", video.contentsHeading);
  check("a video counts segments", video.unitWord === "segments", video.unitWord);
  check("a video has no version diff", video.showChanges === false);

  const doc = sourceView("document");
  check("a document reads 'Contents'", doc.contentsHeading === "Contents", doc.contentsHeading);
  check("a document counts paragraphs", doc.unitWord === "paragraphs", doc.unitWord);
  check("a document offers nothing to watch", doc.showVideoLink === false);
  check("a document shows what changed", doc.showChanges === true);

  // A kind nobody has taught it about must not quietly inherit the video page.
  const unknown = sourceView("library");
  check("an unfamiliar kind is not treated as a video", unknown.isVideo === false);
  check("an unfamiliar kind offers nothing to watch", unknown.showVideoLink === false);
  check("an unfamiliar kind claims no summary", unknown.showSummary === false);
}

async function main() {
  diffGuards();
  sourceViewGuards();
  console.log("\nImport and revision, end to end");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: root, stdio: "ignore", env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

  const path = join(dir, "manual.txt");
  writeFileSync(path, V1);

  const source = await prisma.knowledgeSource.create({
    data: { provider: "upload", kind: "document", externalId: "manual",
            canonicalUrl: `file:${path}`, title: "manual.txt" },
  });
  const run = async () => {
    const job = await prisma.researchJob.create({
      data: { sourceId: source.id, kind: "document", stage: "read" },
    });
    await runDocumentJob({ prisma: prisma as any, job: { id: job.id, sourceId: source.id, stage: "read" }, workerId: "t" });
    return prisma.researchJob.findUnique({ where: { id: job.id } });
  };

  const first = await run();
  check("import succeeds", first?.state === "succeeded", String(first?.errorCode ?? ""));
  check("no model spend on import", (first?.spentMicroUsd ?? 0) === 0);
  let segs = await prisma.transcriptSegment.count();
  check("every paragraph stored", segs === 3, `${segs}`);

  // Re-importing the identical file must not create a second version.
  await run();
  const versionsAfterSame = await prisma.sourceVersion.count({ where: { sourceId: source.id } });
  check("identical re-import makes no new version", versionsAfterSame === 1, `${versionsAfterSame}`);

  // Now a revised manual.
  writeFileSync(path, V2);
  const second = await run();
  check("revision imports", second?.state === "succeeded", String(second?.errorCode ?? ""));
  const versions = await prisma.sourceVersion.count({ where: { sourceId: source.id } });
  check("revision is a new version of the same source", versions === 2, `${versions}`);

  const diff = await prisma.analysisRevision.findFirst({
    where: { pipelineVersion: "diff" }, orderBy: { createdAt: "desc" },
  });
  check("a diff was recorded", Boolean(diff));
  const changes = JSON.parse(diff?.summaryJson ?? "{}").changes ?? [];
  const coverage = JSON.parse(diff?.coverageJson ?? "{}");
  console.log("     changes:", JSON.stringify(changes.map((c: any) => c.kind)));
  check("reworded sentence detected", changes.some((c: any) => c.kind === "changed" && c.after.includes("reconciled")));
  check("new sentence detected", changes.some((c: any) => c.kind === "added" && c.text.includes("New in 2026")));
  check("unchanged text not reported", coverage.unchanged === 2, `${coverage.unchanged} unchanged`);
  check("only changes reported", changes.length === 2, `${changes.length}`);

  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  console.log(bad === 0 ? "\n  PASS" : `\n  ${bad} FAILED`);
  process.exit(bad ? 1 : 0);
}
main();
