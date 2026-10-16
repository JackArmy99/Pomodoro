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
  EXTRACT_JSON_SCHEMA,
  CLASSIFY_JSON_SCHEMA,
  maxTokensFor,
} from "@/lib/research/video/summarise";
import { ratesFor, microUsd } from "@/lib/research/cost";
import {
  searchToolTypesFor,
  rememberSearchToolType,
  SEARCH_TOOL_TYPES,
} from "@/lib/research/web";
import { readFileSync } from "node:fs";
import { applyGlossary, chunksToCues } from "@/lib/research/video/asr";
import {
  pickPlayer,
  pickMediaFile,
  cleanTitle,
  pageDescription,
} from "@/lib/research/video/portal";

// This gate must never spend money. Its checks assume there is no API key —
// always true in a cloud container, but Jack's laptop has one in .env, and the
// "re-analysis" check then made a real, paid model call. An EMPTY value (not a
// deleted one) is deliberate: Prisma loads .env into process.env for any
// variable not already set, which would quietly put the key back.
process.env.ANTHROPIC_API_KEY = "";

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
      takeaways: ["one", "two"],
      points: [
        { heading: "Real", detail: "a", segmentOrdinals: [3, 9999] },
        { heading: "Invented", detail: "b", segmentOrdinals: [4242] },
        { heading: "Late", detail: "c", segmentOrdinals: [900] },
      ],
      steps: [{ text: "Step", segmentOrdinals: [5] }],
      relevance: "HIGH",
    }),
    new Set([3, 5, 900]),
  );
  check("relevance normalised", summary.relevance === "high");
  check("takeaways kept", summary.takeaways.length === 2);
  check("point detail kept", summary.points[0].detail === "a");
  check("invented ordinal stripped", String(summary.points[0].segmentOrdinals) === "3");
  check("uncitable claim dropped", summary.points.length === 2);
  check("drop is recorded", dropped.length === 1 && dropped[0] === "Invented");
  check("late-video citation survives", summary.points.some((p) => p.segmentOrdinals.includes(900)));

  // A revision written before the two-pass split must still render.
  const old = coerceSummary({
    overview: "older revision",
    points: [{ text: "Old point", whyItMatters: "old reason", segmentOrdinals: [1] }],
    steps: [],
    relevance: "low",
  });
  check("old shape maps text -> heading", old.points[0].heading === "Old point");
  check("old shape maps whyItMatters -> detail", old.points[0].detail === "old reason");
  check("missing takeaways defaults to empty", Array.isArray(old.takeaways) && old.takeaways.length === 0);

  // A ten-item list must survive as ten points, not be collapsed.
  const ten = coerceSummary({
    points: Array.from({ length: 10 }, (_, i) => ({
      heading: `Tip ${i + 1}`,
      detail: `how to do tip ${i + 1}`,
      segmentOrdinals: [i],
    })),
  });
  check("a ten-item list stays ten points", ten.points.length === 10);

  for (const bad of [null, {}, { points: "nope" }]) {
    try {
      coerceSummary(bad);
    } catch (e) {
      check(`malformed reply survives: ${JSON.stringify(bad)}`, false, String(e));
    }
  }
  check("malformed model replies survive coercion", true);

  // The schema the API enforces and the shape the code reads must not drift:
  // a field the model is never asked for is a field that never arrives.
  const required = (EXTRACT_JSON_SCHEMA as any).required as string[];
  for (const field of ["overview", "takeaways", "points", "steps", "limits"]) {
    check(`schema requires \`${field}\``, required.includes(field));
  }
  const pointProps = Object.keys(
    (EXTRACT_JSON_SCHEMA as any).properties.points.items.properties,
  );
  for (const field of ["heading", "detail", "segmentOrdinals"]) {
    check(`schema point has \`${field}\``, pointProps.includes(field));
  }
  check(
    "classify schema limits relevance to three values",
    JSON.stringify((CLASSIFY_JSON_SCHEMA as any).properties.relevance.enum) ===
      '["high","medium","low"]',
  );
  // A reply that satisfies the schema must survive coercion untouched.
  const schemaShaped = coerceSummary({
    overview: "o",
    takeaways: ["t"],
    points: [{ heading: "h", detail: "d", segmentOrdinals: [1] }],
    steps: [{ text: "s", segmentOrdinals: [1] }],
    limits: ["l"],
  });
  check(
    "schema-shaped reply coerces cleanly",
    schemaShaped.points[0].heading === "h" &&
      schemaShaped.points[0].detail === "d" &&
      schemaShaped.takeaways.length === 1 &&
      schemaShaped.steps.length === 1,
  );

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
        takeaways: ["Lock the period before you start"],
        points: [{ heading: "Lock the period first", detail: "Stops late postings changing a signed-off number.", segmentOrdinals: [4] }],
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

// Model choice, price and limits. All pure — no call is made — but each line
// is a mistake that would either mis-report what was spent or quietly break
// test mode, which is exactly where nobody looks.
function modelGuards() {
  console.log("\nModels, prices and limits");

  // Price. Haiku 5.5 must never be shown at Haiku 4.5's price: the generic
  // "haiku" match would bill it at roughly ten times its real cost.
  const h55 = ratesFor("claude-haiku-5-5", 2_000);
  check("Haiku 5.5 is priced at $0.10 / $0.50", h55.inRate === 0.1 && h55.outRate === 0.5,
    JSON.stringify(h55));
  const h55long = ratesFor("claude-haiku-5-5", 150_000);
  check("Haiku 5.5 over 100K tokens uses the long-prompt card ($0.50 / $2.50)",
    h55long.inRate === 0.5 && h55long.outRate === 2.5, JSON.stringify(h55long));
  const h45 = ratesFor("claude-haiku-4-5");
  check("Haiku 4.5 is still $1 / $5", h45.inRate === 1 && h45.outRate === 5);
  const s5 = ratesFor("claude-sonnet-5");
  check("Sonnet 5 is still $2 / $10", s5.inRate === 2 && s5.outRate === 10);
  // A typical page assessment: ~3,000 tokens in, ~300 out.
  check("a test-mode assessment costs under a tenth of a penny",
    microUsd("claude-haiku-5-5", 3_000, 300) < 1_000,
    `${microUsd("claude-haiku-5-5", 3_000, 300)} micro-USD`);

  // Output room. Haiku 5.5 thinks by default and counts text as ~30% more
  // tokens; at Haiku 4.5's cap, long webinar notes would be cut off.
  check("Haiku 5.5 gets 32000 output tokens for notes", maxTokensFor("claude-haiku-5-5") === 32000);
  check("Haiku 4.5 keeps 16000", maxTokensFor("claude-haiku-4-5") === 16000);
  check("Sonnet keeps 32000", maxTokensFor("claude-sonnet-5") === 32000);

  // Web-search tool type is remembered per model. One shared value let a
  // Sonnet success lock Haiku to a tool type it doesn't accept.
  const fresh = "claude-test-fresh-model";
  check("an unseen model tries every tool type",
    searchToolTypesFor(fresh).length === SEARCH_TOOL_TYPES.length);
  rememberSearchToolType("claude-test-full", "web_search_20260209");
  check("a full-model success does not narrow another model's options",
    searchToolTypesFor("claude-test-other").length === SEARCH_TOOL_TYPES.length);
  check("but it is remembered for the model it worked on",
    searchToolTypesFor("claude-test-full").join() === "web_search_20260209");

  // The model defaults live in two places — lib/anthropic.ts, and doctor.mjs,
  // which can't import a .ts file. If they drift, doctor approves a model the
  // app doesn't use. Compare the source text.
  const lib = readFileSync(join(root, "lib", "anthropic.ts"), "utf8");
  const doctor = readFileSync(join(root, "scripts", "doctor.mjs"), "utf8");
  const pick = (src: string, env: string) =>
    src.match(new RegExp(`process\\.env\\.${env}\\s*\\|\\|\\s*"([^"]+)"`))?.[1];
  for (const env of ["ANTHROPIC_MODEL", "ANTHROPIC_TEST_MODEL"]) {
    const a = pick(lib, env);
    const b = pick(doctor, env);
    check(`doctor checks the same default ${env} the app uses`, Boolean(a) && a === b,
      `app ${a} · doctor ${b}`);
  }
}

// Videos with no captions (Tagetik webinars) are transcribed on this machine.
// These are the pure, free parts: cleaning Whisper's output and finding the
// video on a real page layout (captured from the Community, 16 Oct 2026).
function transcriptionGuards() {
  console.log("\nWebinars without captions (local transcription)");

  check("Whisper's 'CCH2GETIC' is corrected", applyGlossary("with CCH2GETIC today") === "with CCH Tagetik today");
  check("'CCH Tegetic' is corrected", applyGlossary("with CCH Tegetic.") === "with CCH Tagetik.");
  check("'Walter's Clure' is corrected", applyGlossary("at Walter's Clure.") === "at Wolters Kluwer.");
  // Every variant below came out of the first real webinar.
  for (const heard of ["CCH Digetic", "CCH Degetic", "CCH-Tageta", "CCH2GETIC", "CCH Tagetik"]) {
    check(`'${heard}' becomes CCH Tagetik`, applyGlossary(`with ${heard}.`) === "with CCH Tagetik.",
      applyGlossary(`with ${heard}.`));
  }
  check("'Antigetic' becomes 'and Tagetik'", applyGlossary("planning Antigetic") === "planning and Tagetik");
  check("'cat fix' becomes CapEx", applyGlossary("workforce and cat fix planning") === "workforce and CapEx planning");
  check("ordinary words are left alone", applyGlossary("the target was getting close") === "the target was getting close");

  const cues = chunksToCues([
    { timestamp: [0, 4.2], text: " Hello and welcome." },
    { timestamp: [4.2, 9.8], text: " Today we look at workforce planning." },
    { timestamp: [9.8, 12], text: " we look at workforce planning." }, // seam repeat
    { timestamp: [12, null], text: "  " }, // empty — dropped
    { timestamp: [12.5, null], text: " Thank you." }, // no end time
  ]);
  check("seam repeats and blanks are dropped", cues.length === 3, JSON.stringify(cues.map((c) => c.text)));
  check("ordinals run 0..n after dropping", cues.map((c) => c.ordinal).join() === "0,1,2");
  check("times are milliseconds", cues[1].startMs === 4200 && cues[1].endMs === 9800);
  check("a missing end time gets a sensible one", cues[2].endMs > cues[2].startMs);

  const pageEmbeds = [
    "https://edit-video.tagetik.com/media/product-demo-transform-capex/embed_player",
  ];
  check("the player is found on a webinar page",
    pickPlayer(pageEmbeds) === pageEmbeds[0]);
  check("a page with no player finds none", pickPlayer(["https://www.youtube.com/embed/x"]) === null);
  const playerEmbeds = [
    "https://api.tagetik.com/video/media/x/_thumbnail--hd/ENG.jpg",
    "https://api.tagetik.com/video/media/x/_video/demo%20%28720p%29.mp4?v=1",
    "https://api.tagetik.com/video/media/x/_video/demo%20%281080p%29.mp4?v=1",
  ];
  check("the highest-resolution file is chosen", pickMediaFile(playerEmbeds)!.includes("1080p"));
  check("a thumbnail is never mistaken for the video", pickMediaFile([playerEmbeds[0]]) === null);
  check("the site's name is trimmed from the title",
    cleanTitle("Webinar: Product demo - Transform CapEx | CCH Tagetik Community") ===
      "Webinar: Product demo - Transform CapEx");
  const pageText = [
    "Home", "Library", "Webinar: Demo", "Library",
    "Browse our resources to enhance your understanding of CCH Tagetik",
    "Webinars | September 16, 2026", "Webinar: Demo",
    "See how CCH Tagetik brings capital expenditure planning and workforce planning together.",
  ].join("\n");
  check("the description is the one under the heading, not the Library blurb",
    pageDescription(pageText, "Webinar: Demo").startsWith("See how"));
}

async function main() {
  modelGuards();
  transcriptionGuards();
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
