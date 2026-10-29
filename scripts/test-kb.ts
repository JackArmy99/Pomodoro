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

async function main() {
  authorityGuards();

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
