import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  authorityFor,
  classification,
  defaultDocType,
  isManualTier,
  normaliseRelease,
} from "@/lib/knowledge/authority";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { readPdf } from "@/lib/knowledge/pdfText";
import { buildSections, sectionsFromHeadings, titleKey } from "@/lib/kb/sections";
import { toSegments } from "@/lib/knowledge/documents";

// Free gate for the knowledge base (docs/knowledge-base-plan.md): a throwaway
// database, no model calls, nothing written outside a temp folder.
// M0: source authority, releases, and two editions of one manual.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "beacon-kbtest-"));
const dbPath = join(dir, "t.db");
// Set BEFORE lib/db is imported (below, dynamically), so the app's own client
// opens the throwaway database. Empty key, not deleted: Prisma would reload a
// deleted one from .env and a "free" gate would spend.
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.ANTHROPIC_API_KEY = "";
process.env.BEACON_DOCUMENTS_DIR = join(dir, "documents");

let bad = 0;
const check = (n: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${d ? " — " + d : ""}`);
  if (!ok) bad++;
};

const OLD = `Consolidation overview.

Intercompany balances must be matched before elimination.

Currency translation uses the closing rate.`;

const NEW = `Consolidation overview.

Intercompany balances must be reconciled and matched prior to elimination.

Currency translation uses the closing rate.

New in 2026: validation runs automatically on lock.`;

function authorityGuards() {
  console.log("\nSource authority (rule in code)");
  check("a manual is tier 1", authorityFor("manual") === 1);
  check("release notes are tier 2", authorityFor("release_notes") === 2);
  check("a webinar is tier 3", authorityFor("webinar") === 3);
  check("marketing is tier 4", authorityFor("promotional") === 4);
  check("news and forum posts are tier 5", authorityFor("news") === 5 && authorityFor("community") === 5);
  check("an unclassified source is the LOWEST tier", authorityFor(null) === 5 && authorityFor("made_up") === 5);
  check(
    "only a manual may write manual content",
    isManualTier(1) && [2, 3, 4, 5, null].every((t) => !isManualTier(t)),
  );
  check("an uploaded file is never assumed to be a manual", defaultDocType("document") === null);
  check(
    "videos default to webinar",
    defaultDocType("youtube") === "webinar" && defaultDocType("portal_video") === "webinar",
  );
  check("watched pages default to community", defaultDocType("page") === "community");
  check(
    "an unknown doc type is stored as unclassified",
    JSON.stringify(classification("made_up")) === JSON.stringify({ docType: null, authority: 5 }),
  );

  console.log("\nReleases");
  check("a release is tidied", normaliseRelease("  2026   SP1 ") === "2026 SP1");
  check("blank means not known", normaliseRelease("") === null && normaliseRelease(null) === null);
  check("'unknown' means not known", normaliseRelease("Unknown") === null && normaliseRelease("n/a") === null);
}


// ---------------------------------------------------------------------------
// A tiny PDF writer, so the gate needs no real manual: Helvetica text at given
// sizes and heights, a running header and footer on every page, and optional
// bookmarks. Enough to prove the reader and the outline logic.
// ---------------------------------------------------------------------------
type L = { text: string; size: number; y: number };
type Mark = { title: string; page: number; kids?: Mark[] };

function makePdf(pages: L[][], marks?: Mark[]): Buffer {
  const objs: string[] = [];
  const add = (body: string) => (objs.push(body), objs.length);
  const esc = (t: string) => t.replace(/([\\()])/g, "\\$1");
  add("catalog"); // 1, filled in below
  add("pages"); // 2, filled in below
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  pages.forEach((lines, i) => {
    const all = [
      { text: "Consolidation Guide 2025 | Wolters Kluwer", size: 8, y: 815 },
      ...lines,
      { text: `Page ${i + 1}`, size: 8, y: 25 },
    ];
    const stream = all.map((l) => `BT /F1 ${l.size} Tf 50 ${l.y} Td (${esc(l.text)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  });
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let outlinesRef = "";
  if (marks?.length) {
    const rootId = add("outlines");
    const build = (list: Mark[], parent: number): number[] => {
      const ids = list.map(() => add("item"));
      list.forEach((m, i) => {
        const kidIds = m.kids?.length ? build(m.kids, ids[i]) : [];
        const parts = [
          `/Title (${esc(m.title)})`,
          `/Parent ${parent} 0 R`,
          `/Dest [${pageIds[m.page - 1]} 0 R /XYZ 0 842 0]`,
          i > 0 ? `/Prev ${ids[i - 1]} 0 R` : "",
          i < ids.length - 1 ? `/Next ${ids[i + 1]} 0 R` : "",
          kidIds.length
            ? `/First ${kidIds[0]} 0 R /Last ${kidIds[kidIds.length - 1]} 0 R /Count ${kidIds.length}`
            : "",
        ];
        objs[ids[i] - 1] = `<< ${parts.filter(Boolean).join(" ")} >>`;
      });
      return ids;
    };
    const top = build(marks, rootId);
    objs[rootId - 1] = `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top[top.length - 1]} 0 R /Count ${top.length} >>`;
    outlinesRef = ` /Outlines ${rootId} 0 R /PageMode /UseOutlines`;
  }
  objs[0] = `<< /Type /Catalog /Pages 2 0 R${outlinesRef} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const H1 = 18;
const H2 = 12;
const BODY = 10;
// Six pages: a contents page, then numbered chapters. Body paragraphs span two
// lines (one paragraph) with a wider gap before the next paragraph.
const MANUAL_PAGES: L[][] = [
  [
    { text: "Contents", size: H1, y: 760 },
    { text: "1 Overview 2", size: BODY, y: 730 },
    { text: "2 Intercompany 3", size: BODY, y: 716 },
    { text: "3 Currency translation 4", size: BODY, y: 702 },
  ],
  [
    { text: "1 Overview", size: H1, y: 760 },
    { text: "Consolidation combines the results of the group", size: BODY, y: 730 },
    { text: "entities into one set of accounts.", size: BODY, y: 718 },
    { text: "Data is collected per entity and period.", size: BODY, y: 690 },
  ],
  [
    { text: "2 Intercompany", size: H1, y: 760 },
    { text: "Intercompany transactions are removed on consolidation.", size: BODY, y: 730 },
    { text: "2.1 Matching", size: H2, y: 700 },
    { text: "Balances must be matched before elimination.", size: BODY, y: 680 },
    { text: "2.2 Elimination", size: H2, y: 650 },
    { text: "Matched balances are eliminated automatically.", size: BODY, y: 630 },
  ],
  [
    { text: "Elimination journals are posted to a dedicated layer.", size: BODY, y: 760 },
    { text: "3 Currency translation", size: H1, y: 700 },
    { text: "Foreign entities are translated into the group currency.", size: BODY, y: 670 },
  ],
  [
    { text: "3.1 Closing rate", size: H2, y: 760 },
    { text: "Balance sheet items use the closing rate.", size: BODY, y: 740 },
  ],
  [
    { text: "4 Validation", size: H1, y: 760 },
    { text: "Validation rules run when the period is locked.", size: BODY, y: 730 },
  ],
];
const MANUAL_MARKS: Mark[] = [
  { title: "Overview", page: 2 },
  { title: "Intercompany", page: 3, kids: [{ title: "Matching", page: 3 }, { title: "Elimination", page: 3 }] },
  { title: "Currency translation", page: 4, kids: [{ title: "Closing rate", page: 5 }] },
  { title: "Validation", page: 6 },
];

async function readerGuards() {
  console.log("\nReading a PDF manual (layout-aware, free)");
  const read = await readPdf(makePdf(MANUAL_PAGES, MANUAL_MARKS));
  const all = read.pages.map((p) => p.text).join("\n\n");
  check("the running header is dropped", !all.includes("Consolidation Guide 2025"));
  check("the page-number footer is dropped", !/Page \d/.test(all));
  const segs = toSegments(read.pages);
  check(
    "a two-line paragraph stays one paragraph",
    segs.some((s) => s.text === "Consolidation combines the results of the group entities into one set of accounts."),
  );
  check("a heading is its own paragraph", segs.some((s) => s.text === "2.1 Matching"));
  const p3 = segs.filter((s) => s.page === 3).length;
  check("page 3 splits into its six paragraphs", p3 === 6, `${p3}`);
  check(
    "bookmarks are read with depth and page",
    read.outline.length === 7 &&
      read.outline[2].title === "Matching" &&
      read.outline[2].level === 2 &&
      read.outline[2].page === 3,
    JSON.stringify(read.outline[2]),
  );

  console.log("\nTable of contents -> sections (free)");
  const secs = buildSections(read.outline, segs);
  check("one section per bookmark", secs.length === 7, `${secs.length}`);
  const at = (title: string) => secs.find((s) => s.title === title)!;
  const textAt = (o: number | null) => segs.find((s) => s.ordinal === o)?.text ?? "";
  const off = secs.filter((s) => titleKey(textAt(s.startOrdinal)) !== titleKey(s.title));
  check(
    "every section starts on its own heading (numbers ignored)",
    off.length === 0,
    off.map((s) => s.title).join(", "),
  );
  check("two sections on one page are told apart", at("Matching").startOrdinal! < at("Elimination").startOrdinal!);
  check(
    "a chapter covers its subsections",
    at("Intercompany").endOrdinal! >= at("Elimination").endOrdinal! &&
      at("Intercompany").endOrdinal! < at("Currency translation").startOrdinal!,
  );
  check(
    "a section runs on to the next page",
    textAt(at("Elimination").endOrdinal) === "Elimination journals are posted to a dedicated layer.",
    textAt(at("Elimination").endOrdinal),
  );
  check("paths follow the tree", at("Closing rate").path === "3.1" && at("Validation").path === "4");

  const noMarks = await readPdf(makePdf(MANUAL_PAGES));
  check("a PDF without bookmarks has no outline", noMarks.outline.length === 0);
  const hSegs = toSegments(noMarks.pages);
  const hSecs = buildSections(noMarks.outline, hSegs);
  check(
    "...so numbered headings are used instead",
    hSecs.length === 7 && hSecs[0].method === "headings",
    hSecs.map((s) => s.path).join(","),
  );
  check(
    "contents-page lines are not taken for headings",
    hSecs.every((s) => hSegs.find((g) => g.ordinal === s.startOrdinal)!.page !== 1),
  );
  check("heading numbers become the path", hSecs.find((s) => s.title === "Matching")?.path === "2.1");
  check(
    "plain text with no headings gives no sections",
    sectionsFromHeadings([{ ordinal: 0, page: 1, text: "Hello." }]).length === 0,
  );
}

// The audit log is append-only: nothing in the app may update or delete it.
function appendOnlyGuard() {
  console.log("\nThe audit log is append-only");
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const full = join(d, f);
      if (statSync(full).isDirectory()) {
        if (f !== "node_modules") walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(f)) continue;
      const src = readFileSync(full, "utf8");
      if (/kbEvent\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/.test(src)) offenders.push(full);
    }
  };
  for (const d of ["app", "lib", "components"]) walk(join(root, d));
  check("no code updates or deletes a KbEvent", offenders.length === 0, offenders.join(", "));
}

async function main() {
  authorityGuards();
  await readerGuards();
  appendOnlyGuard();

  console.log("\nTwo editions of one manual, end to end");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env },
    shell: process.platform === "win32", // npx is npx.cmd on Windows
  });
  const { prisma } = await import("@/lib/db");
  const { enqueueDocument } = await import("@/lib/knowledge/sources");
  const { runDocumentJob } = await import("@/lib/knowledge/documentPipeline");

  const work = async (sourceId: string) => {
    const job = await prisma.researchJob.findFirst({
      where: { sourceId, state: "queued" },
      orderBy: { createdAt: "desc" },
    });
    await runDocumentJob({ prisma, job: { id: job!.id, sourceId, stage: "read" }, workerId: "t" });
    return prisma.researchJob.findUnique({ where: { id: job!.id } });
  };

  try {
    // The older edition first, as a manual for release 2025.
    const a = await enqueueDocument("Consolidation_Guide_2025.txt", Buffer.from(OLD), {
      docType: "manual",
      release: " 2025 ",
    });
    check("older edition queued", a.ok);
    if (!a.ok) throw new Error(a.error);
    const j1 = await work(a.sourceId);
    check("older edition imports", j1?.state === "succeeded", String(j1?.errorCode ?? ""));
    check("no model spend on import", (j1?.spentMicroUsd ?? 0) === 0);
    let src = await prisma.knowledgeSource.findUnique({ where: { id: a.sourceId } });
    check(
      "stored as a manual, tier 1",
      src?.docType === "manual" && src?.authority === 1,
      `${src?.docType}/${src?.authority}`,
    );
    const v1 = await prisma.sourceVersion.findFirst({ where: { sourceId: a.sourceId, version: 1 } });
    check("version 1 records release 2025", v1?.release === "2025", String(v1?.release));
    const paged = await prisma.transcriptSegment.count({
      where: { sourceVersionId: v1!.id, page: { not: null } },
    });
    check("every paragraph stored with its page", paged === 3, `${paged}`);

    // The current edition: a DIFFERENT file name, marked as a new edition.
    const b = await enqueueDocument("Consolidation_Guide_2026.txt", Buffer.from(NEW), {
      docType: "manual",
      release: "2026",
      versionOf: a.sourceId,
    });
    check("a renamed file joins the same document", b.ok && b.sourceId === a.sourceId && !b.created);
    const j2 = await work(a.sourceId);
    check("newer edition imports", j2?.state === "succeeded", String(j2?.errorCode ?? ""));
    const versions = await prisma.sourceVersion.findMany({
      where: { sourceId: a.sourceId },
      orderBy: { version: "asc" },
    });
    check("two versions of one source", versions.length === 2, `${versions.length}`);
    check("version 2 records release 2026", versions[1]?.release === "2026", String(versions[1]?.release));
    check("version 1 still says 2025", versions[0]?.release === "2025");
    src = await prisma.knowledgeSource.findUnique({ where: { id: a.sourceId } });
    check("the document keeps its name", src?.title === "Consolidation_Guide_2025.txt", String(src?.title));
    check("the newer edition is current", src?.currentVersionId === versions[1]?.id);
    const diff = await prisma.analysisRevision.findFirst({
      where: { sourceVersionId: versions[1]!.id, pipelineVersion: "diff" },
    });
    const changes = JSON.parse(diff?.summaryJson ?? "{}").changes ?? [];
    check("the editions were compared", changes.length === 2, `${changes.length} changes`);

    // Without a doc type an upload stays unclassified and lowest tier.
    const c = await enqueueDocument("brochure.txt", Buffer.from("Buy now."));
    const brochure = c.ok ? await prisma.knowledgeSource.findUnique({ where: { id: c.sourceId } }) : null;
    check(
      "an unclassified upload is tier 5, not a manual",
      brochure?.docType === null && brochure?.authority === 5,
    );

    const d = await enqueueDocument("x.txt", Buffer.from("x"), { versionOf: "no-such-id" });
    check("a missing 'edition of' is refused, not silently a new document", !d.ok);

    // ---- M1: the topic tree ------------------------------------------------
    console.log("\nA manual's topic tree, end to end");
    const {
      proposeTree,
      renameTopic,
      indentTopic,
      outdentTopic,
      mergeTopic,
      deleteTopic,
      addTopic,
      approveTree,
      topicTree,
    } = await import("@/lib/kb/topics");
    const consol = await prisma.module.create({ data: { name: "Consolidation" } });
    const pdf = await enqueueDocument("Consolidation_2025.pdf", makePdf(MANUAL_PAGES, MANUAL_MARKS), {
      docType: "manual",
      release: "2025",
      moduleId: consol.id,
    });
    if (!pdf.ok) throw new Error(pdf.error);
    const jp = await work(pdf.sourceId);
    check("the PDF manual imports", jp?.state === "succeeded", String(jp?.errorCode ?? ""));
    const steps = JSON.parse(jp?.detail ?? "{}").steps ?? [];
    check(
      "the import records its contents step",
      steps.some((st: any) => st.stage === "outline" && /7 sections from the bookmarks/.test(st.note ?? "")),
      JSON.stringify(steps.map((st: any) => st.note).filter(Boolean)),
    );
    const man = await prisma.knowledgeSource.findUnique({ where: { id: pdf.sourceId } });
    check("the manual knows its module", man?.moduleId === consol.id);
    const ver = man!.currentVersionId!;
    check("its sections are stored", (await prisma.docSection.count({ where: { sourceVersionId: ver } })) === 7);
    check("no model spend building the contents", (jp?.spentMicroUsd ?? 0) === 0);

    // Only a manual may build the tree.
    const promo = await prisma.knowledgeSource.create({
      data: {
        provider: "upload",
        kind: "document",
        externalId: "promo",
        canonicalUrl: "file:x",
        title: "promo",
        ...classification("promotional"),
      },
    });
    const promoVer = await prisma.sourceVersion.create({ data: { sourceId: promo.id } });
    const refused = await proposeTree(prisma, { sourceVersionId: promoVer.id, moduleId: consol.id, actor: "jack" });
    check("a non-manual source can't build the tree", !refused.ok);

    const r = await proposeTree(prisma, { sourceVersionId: ver, moduleId: consol.id, actor: "jack" });
    check("the manual proposes a tree", r.ok && r.count === 7, JSON.stringify(r));
    let tree = await topicTree(prisma, consol.id);
    check(
      "its shape follows the contents",
      tree.map((t) => t.title).join("|") === "Overview|Intercompany|Currency translation|Validation" &&
        tree[1].children.map((c) => c.title).join("|") === "Matching|Elimination",
      tree.map((t) => t.title).join("|"),
    );
    check("every topic starts as a draft", (await prisma.kbTopic.count({ where: { status: "draft" } })) === 7);
    const again = await proposeTree(prisma, { sourceVersionId: ver, moduleId: consol.id, actor: "jack" });
    check("a second build never replaces the tree", !again.ok);
    const proposedEvents = await prisma.kbEvent.count({ where: { moduleId: consol.id, action: "proposed" } });
    check("each proposed topic is logged, plus the tree", proposedEvents === 8, `${proposedEvents}`);

    // Editing, each step logged.
    const ic = tree[1];
    const matching = ic.children[0];
    const elim = ic.children[1];
    const before = await prisma.kbEvent.count();
    await renameTopic(prisma, ic.id, "Intercompany & eliminations");
    const renamed = await prisma.kbEvent.findFirst({ where: { entityId: ic.id, action: "renamed" } });
    check("a rename is logged with before and after", renamed?.beforeJson === JSON.stringify({ title: "Intercompany" }));
    await mergeTopic(prisma, elim.id, matching.id);
    const matchSecs = await prisma.docSection.count({ where: { topicId: matching.id } });
    check("merging moves the manual sections across", matchSecs === 2, `${matchSecs}`);
    check("the merged topic is gone", !(await prisma.kbTopic.findUnique({ where: { id: elim.id } })));
    check("deleting a topic that holds sections is refused", !(await deleteTopic(prisma, matching.id)).ok);
    const added = await addTopic(prisma, consol.id, null, "Ownership");
    check("an empty topic can be added and deleted", added.ok && (await deleteTopic(prisma, added.id!)).ok);
    await outdentTopic(prisma, matching.id);
    tree = await topicTree(prisma, consol.id);
    check(
      "un-nesting puts it right after its old parent",
      tree.map((t) => t.title).join("|") ===
        "Overview|Intercompany & eliminations|Matching|Currency translation|Validation",
      tree.map((t) => t.title).join("|"),
    );
    await indentTopic(prisma, matching.id);
    tree = await topicTree(prisma, consol.id);
    check("nesting puts it back under the topic above", tree[1].children.some((c) => c.id === matching.id));
    check(
      "merging a topic into its own sub-topic is refused",
      !(await mergeTopic(prisma, tree[1].id, matching.id)).ok,
    );
    const deep = await addTopic(prisma, consol.id, matching.id, "Level 3");
    check("a third level is allowed", deep.ok);
    check("a fourth level is refused", !(await addTopic(prisma, consol.id, deep.ok ? deep.id! : "", "Level 4")).ok);
    check("every edit was logged", (await prisma.kbEvent.count()) - before >= 7, `${(await prisma.kbEvent.count()) - before}`);

    const ap = await approveTree(prisma, consol.id);
    check(
      "approving makes every topic approved",
      ap.ok && (await prisma.kbTopic.count({ where: { moduleId: consol.id, status: "draft" } })) === 0,
    );
    check(
      "the approval is logged",
      (await prisma.kbEvent.count({ where: { entityType: "tree", action: "approved" } })) === 1,
    );

    // Sections deeper than the proposed depth are filed under their ancestor.
    const other = await prisma.module.create({ data: { name: "Other" } });
    const shallow = await proposeTree(prisma, { sourceVersionId: ver, moduleId: other.id, actor: "jack", maxDepth: 1 });
    const otherIc = (await topicTree(prisma, other.id)).find((t) => t.title === "Intercompany");
    check(
      "deeper sections file under their nearest topic",
      shallow.ok && shallow.count === 4 && otherIc?.sections === 3,
      `${shallow.ok && shallow.count} topics, ${otherIc?.sections} sections`,
    );

    // Clients: release not known until Jack says.
    const client = await prisma.client.create({ data: { name: "Falcon" } });
    check("a client's release starts as unknown", client.tagetikRelease === null);
    const set = await prisma.client.update({
      where: { id: client.id },
      data: { tagetikRelease: normaliseRelease("2025") },
    });
    check("a client's release can be set", set.tagetikRelease === "2025");
  } finally {
    await prisma.$disconnect();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows: best effort */
    }
  }

  console.log(bad === 0 ? "\n  PASS" : `\n  ${bad} FAILED`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
