// Gate for the video pipeline. Runs against a brand-new throwaway database and
// makes NO model calls, so it is free and repeatable. Run: npm run test:video
//
// It covers the three things that have actually gone wrong or would be
// expensive to get wrong:
//   1. Invented timestamps must be dropped, not displayed.
//   2. Re-analysing a stored video must NOT re-fetch its captions.
//   3. Re-running must update the one inbox item, never create a second.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { runVideoJob } from "@/lib/research/video/pipeline";
import { isVerifiedCurrent } from "@/lib/research/revision";
import {
  coerceSummary,
  enforceCitations,
  splitIntoPasses,
} from "@/lib/research/video/summarise";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "beacon-videotest-"));
const dbPath = join(dir, "test.db");

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
}

const seg = (n: number) => ({ ordinal: n, startMs: n * 1000, text: `line ${n}` });

// 1. Citations ---------------------------------------------------------------
function citationGuards() {
  console.log("\nCitation guards (no database needed)");
  const { summary, dropped } = enforceCitations(
    coerceSummary({
      overview: "x",
      points: [
        { text: "Real", whyItMatters: "a", segmentOrdinals: [3, 9999] },
        { text: "Invented", whyItMatters: "b", segmentOrdinals: [4242] },
        { text: "Late", whyItMatters: "c", segmentOrdinals: [900] },
      ],
      steps: [{ text: "Step", segmentOrdinals: [5] }],
      relevance: "HIGH",
    }),
    new Set([3, 5, 900]),
  );
  check("relevance normalised", summary.relevance === "high");
  check("invented ordinal stripped", String(summary.points[0].segmentOrdinals) === "3");
  check("uncitable claim dropped", summary.points.length === 2);
  check("drop is recorded", dropped.length === 1 && dropped[0] === "Invented");
  check("late-video citation survives", summary.points.some((p) => p.segmentOrdinals.includes(900)));

  for (const bad of [null, {}, { points: "nope" }]) {
    try {
      coerceSummary(bad);
    } catch (e) {
      check(`malformed reply survives: ${JSON.stringify(bad)}`, false, String(e));
    }
  }
  check("malformed model replies survive coercion", true);

  const many = Array.from({ length: 20000 }, (_, i) => ({ ...seg(i), text: "word ".repeat(12) }));
  check("ordinary video is one pass", splitIntoPasses(Array.from({ length: 902 }, (_, i) => seg(i))).length === 1);
  check("very long video splits", splitIntoPasses(many).length > 1);
  check("splitting keeps every segment", splitIntoPasses(many).flat().length === many.length);
}

// 2 + 3. Pipeline ------------------------------------------------------------
async function pipelineGuards(prisma: PrismaClient) {
  const mod = await prisma.module.create({ data: { name: "Consolidation" } });

  async function makeSource(externalId: string, title: string) {
    const source = await prisma.knowledgeSource.create({
      data: {
        provider: "youtube",
        externalId,
        canonicalUrl: `https://www.youtube.com/watch?v=${externalId}`,
        title,
      },
    });
    const version = await prisma.sourceVersion.create({
      data: { sourceId: source.id, version: 1 },
    });
    await prisma.transcriptSegment.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        sourceVersionId: version.id,
        ordinal: i,
        startMs: i * 1000,
        endMs: i * 1000 + 900,
        text: `line ${i}`,
      })),
    });
    await prisma.knowledgeSource.update({
      where: { id: source.id },
      data: { currentVersionId: version.id },
    });
    return { source, version };
  }

  async function runAt(sourceId: string, stage: string) {
    const job = await prisma.researchJob.create({
      data: { sourceId, kind: "analyse", stage },
    });
    await runVideoJob({
      prisma: prisma as any,
      job: { id: job.id, sourceId, stage },
      workerId: "test",
    });
    return prisma.researchJob.findUnique({ where: { id: job.id } });
  }

  console.log("\nRe-analysis must not re-fetch captions");
  const a = await makeSource("RESUMETEST1", "A stored video");
  const started = Date.now();
  const job = await runAt(a.source.id, "summarise");
  const elapsed = Date.now() - started;
  // Without an API key the summarise stage stops with `no_api_key`. Any caption
  // error here would mean it went back to YouTube for a transcript we hold.
  check("reached summarise, not captions", job?.errorCode === "no_api_key", String(job?.errorCode));
  check("recoverable, not fatal", job?.state === "needs_input");
  check("no network round-trip", elapsed < 3000, `${elapsed}ms`);
  check(
    "transcript untouched",
    (await prisma.transcriptSegment.count({ where: { sourceVersionId: a.version.id } })) === 50,
  );

  console.log("\nOne inbox item per video, however often it runs");
  const b = await makeSource("FINDINGTEST1", "Consolidation close walkthrough");
  await prisma.analysisRevision.create({
    data: {
      sourceVersionId: b.version.id,
      status: "published",
      summaryJson: JSON.stringify({
        overview: "How to run a group close.",
        points: [{ text: "Lock the period first", whyItMatters: "avoids restatement", segmentOrdinals: [4] }],
        steps: [{ text: "Open the close monitor", segmentOrdinals: [7] }],
        limits: ["Does not cover intercompany"],
        relevance: "high",
        relevanceReason: "core module work",
        modules: [mod.name],
      }),
    },
  });

  const first = await runAt(b.source.id, "finding");
  check("published revision is reused, not re-bought", first?.state === "succeeded" && (first?.spentMicroUsd ?? 0) === 0);

  let findings = await prisma.finding.findMany({
    where: { knowledgeSourceId: b.source.id },
    include: { modules: true },
  });
  check("exactly one finding", findings.length === 1);
  check("lands pending and unverified", findings[0]?.status === "pending" && !isVerifiedCurrent(findings[0]));
  check("carries the summary text", (findings[0]?.summary ?? "").includes("Lock the period first"));
  check("links back to the video", findings[0]?.sourceType === "video");
  check("module mapped", findings[0]?.modules.length === 1);

  await prisma.finding.update({
    where: { id: findings[0].id },
    data: { verified: true, verifiedRevision: findings[0].contentRevision, verifiedAt: new Date() },
  });
  await runAt(b.source.id, "finding");
  findings = await prisma.finding.findMany({
    where: { knowledgeSourceId: b.source.id },
    include: { modules: true },
  });
  check("still exactly one finding", findings.length === 1, `${findings.length}`);
  check("re-summarising clears a stale tick", !isVerifiedCurrent(findings[0]));
}

async function main() {
  console.log("Building a throwaway database…");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: root,
    stdio: "ignore",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });

  citationGuards();

  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbPath}` } },
  });
  try {
    await pipelineGuards(prisma);
  } finally {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    failures === 0
      ? "\n✅ Video pipeline checks passed."
      : `\n❌ ${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nVideo test hit an unexpected problem:", err);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
});
