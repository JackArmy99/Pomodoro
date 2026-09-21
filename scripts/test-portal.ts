// Guardrails for the portal agent. No network, no browser, no portal account —
// these are the rules, tested as rules. Run: npm run test:portal
import {
  checkUrl,
  permittedLinks,
  rejectedLinks,
  allowedHosts,
} from "@/lib/portal/allowlist";
import { createReader, Blocked, CapReached } from "@/lib/portal/fetch";
import { jobHandlerFor, retryKindFor } from "@/lib/knowledge/jobKinds";
import { parseDetail, closeRun } from "@/lib/knowledge/runLog";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

let bad = 0;
const check = (n: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${d ? " — " + d : ""}`);
  if (!ok) bad++;
};

// A .mjs file is native ESM; Node resolves its named imports before tsx has
// transformed the .ts module, so the bindings aren't there yet and it dies with
// "does not provide an export named X". Dynamic imports happen to survive it,
// which makes the failure look random and machine-dependent. Scripts that need
// project code must be .ts.
console.log("\nScript module boundaries");
{
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const offenders: string[] = [];
  for (const name of readdirSync(scriptsDir)) {
    if (!name.endsWith(".mjs")) continue;
    const body = readFileSync(join(scriptsDir, name), "utf8");
    // Static `import ... from "....ts"` only — a dynamic import() is fine.
    if (/^\s*import\s[^;]*?from\s+["'][^"']+\.ts["']/m.test(body)) {
      offenders.push(name);
    }
  }
  check(
    "no .mjs script statically imports a .ts module",
    offenders.length === 0,
    offenders.join(", "),
  );
}

console.log("\nAllowlist");
check("a tagetik page is allowed", checkUrl("https://www.tagetik.com/release-notes").ok);
check("a subdomain is allowed", checkUrl("https://support.tagetik.com/x").ok);
check("another site is refused", !checkUrl("https://example.com/x").ok);
check("a lookalike host is refused", !checkUrl("https://tagetik.com.evil.net/x").ok,
  checkUrl("https://tagetik.com.evil.net/x").ok ? "ALLOWED!" : "");
check("plain http is refused", !checkUrl("http://www.tagetik.com/x").ok);
check("file: is refused", !checkUrl("file:///etc/passwd").ok);
check("credentials in the URL are refused", !checkUrl("https://u:p@www.tagetik.com/x").ok);
check("nonsense is refused", !checkUrl("not a url").ok);

console.log("\nLinks found on a page");
const links = permittedLinks(
  ["/notes/2026", "https://example.com/tracker", "https://support.tagetik.com/a#top",
   "https://support.tagetik.com/a#bottom", "mailto:someone@x.com"],
  "https://www.tagetik.com/index",
);
check("off-site links are dropped", !links.some((l) => l.includes("example.com")));
check("mailto is dropped", !links.some((l) => l.startsWith("mailto")));
check("relative links resolve", links.some((l) => l === "https://www.tagetik.com/notes/2026"));
check("the same page twice is one page", links.filter((l) => l.includes("support.tagetik.com/a")).length === 1);

// A webinar's video normally lives on someone else's host, so silently dropping
// off-allowlist links hid the one fact worth knowing. Reporting a host is not
// visiting it — checkUrl still refuses every one of them.
console.log("\nWhat it is NOT allowed to follow");
{
  const rejected = rejectedLinks(
    [
      "https://play.vidyard.com/abc",
      "https://play.vidyard.com/def",
      "https://www.youtube.com/watch?v=x",
      "/notes/2026",
      "mailto:someone@x.com",
      "javascript:void(0)",
    ],
    "https://www.tagetik.com/index",
  );
  const hosts = rejected.map((r) => r.host);
  check("an off-allowlist host is reported", hosts.includes("play.vidyard.com"));
  check("a second player host is reported", hosts.includes("www.youtube.com"));
  check("repeats are counted, not listed twice",
    rejected.find((r) => r.host === "play.vidyard.com")?.count === 2,
    JSON.stringify(rejected.map((r) => [r.host, r.count])));
  check("an allowed link is not in the rejected list",
    !hosts.includes("www.tagetik.com"));
  check("page furniture is ignored",
    !hosts.some((h) => h === "" || h.includes("mailto")));
  check("reporting a host does NOT make it fetchable",
    rejected.every((r) => !checkUrl(r.example).ok));
}

// The bug this replaced: ResearchJob.kind defaults to "video", requeueSource
// created jobs without one, and the worker's routing fell through to the video
// pipeline — so "Try again" on a Tagetik page asked YouTube for captions.
console.log("\nWhich pipeline a job belongs to");
{
  check("retrying a page makes a page job", retryKindFor("page") === "page");
  check("retrying a document makes a document job",
    retryKindFor("document") === "document");
  check("retrying a video makes a video job", retryKindFor("youtube") === "video");

  check("a page job runs the page pipeline",
    jobHandlerFor("page", "page").handler === "page");
  check("a preview runs the page pipeline",
    jobHandlerFor("page_dry", "page").handler === "page");
  check("an assess job runs the assess pipeline",
    jobHandlerFor("page_assess", "page").handler === "page_assess");
  check("a video job runs the video pipeline",
    jobHandlerFor("video", "youtube").handler === "video");

  // The regression itself.
  const misrouted = jobHandlerFor("video", "page");
  check("a VIDEO job on a PAGE source does not reach the video pipeline",
    misrouted.handler === "page", misrouted.handler);
  check("and the correction is recorded, not silent", Boolean(misrouted.corrected));
  check("a video job on a document source runs the document pipeline",
    jobHandlerFor("video", "document").handler === "document");
  check("an unknown job kind follows the source",
    jobHandlerFor("mystery", "page").handler === "page");
}

console.log("\nReading pages");
function fakeBrowser(status: number | null = 200) {
  const visited: string[] = [];
  return {
    visited,
    ctx: {
      async goto(url: string) { visited.push(url); return { status }; },
      async content() {
        return {
          title: "T",
          text: "body text",
          links: ["https://example.com/tracker"],
          embeds: ["https://play.vidyard.com/watch/abc"],
        };
      },
      async wait() {},
    },
  };
}

(async () => {
  const dry = fakeBrowser();
  const dryReader = createReader(dry.ctx, { dryRun: true });
  await dryReader.read("https://www.tagetik.com/a");
  check("a dry run retrieves nothing", dry.visited.length === 0);
  check("a dry run still says what it would do", dryReader.log[0]?.outcome === "would-fetch");

  const off = fakeBrowser();
  const offReader = createReader(off.ctx);
  await offReader.read("https://example.com/a");
  check("an off-allowlist page is never visited", off.visited.length === 0);
  check("the refusal is logged with a reason", offReader.log[0]?.outcome === "refused" && Boolean(offReader.log[0]?.note));

  const capped = fakeBrowser();
  const capReader = createReader(capped.ctx, { cap: 2, delayMs: 0 });
  await capReader.read("https://www.tagetik.com/1");
  await capReader.read("https://www.tagetik.com/2");
  let stopped = false;
  try { await capReader.read("https://www.tagetik.com/3"); } catch (e) { stopped = e instanceof CapReached; }
  check("the page cap stops the run", stopped, `${capped.visited.length} visited`);
  check("the cap is not exceeded", capped.visited.length === 2);

  for (const [status, label] of [[429, "rate limiting"], [403, "refusal"]] as const) {
    const blocked = fakeBrowser(status);
    const reader = createReader(blocked.ctx, { delayMs: 0 });
    let aborted = false;
    try { await reader.read("https://www.tagetik.com/a"); } catch (e) { aborted = e instanceof Blocked; }
    check(`a ${status} (${label}) aborts rather than retrying`, aborted);
    check(`the ${status} is logged as blocked`, reader.log[0]?.outcome === "blocked");
  }

  const ok = fakeBrowser();
  const reader = createReader(ok.ctx, { delayMs: 0 });
  const page = await reader.read("https://www.tagetik.com/a");
  check("a permitted page is read", page?.text === "body text");
  check("every read is logged", reader.log[0]?.outcome === "fetched" && Boolean(reader.log[0]?.at));
  check("an embedded player is reported",
    page?.embeds.includes("https://play.vidyard.com/watch/abc") ?? false,
    JSON.stringify(page?.embeds));
  check("the embed's host is named as not followed",
    page?.notFollowed.some((n) => n.host === "play.vidyard.com") ?? false);
  check("an off-allowlist link is named but still not followed",
    (page?.notFollowed.some((n) => n.host === "example.com") ?? false) &&
      !(page?.links.some((l) => l.includes("example.com")) ?? true));
  check("nothing extra was visited", ok.visited.length === 1, `${ok.visited.length}`);

  check("the allowlist is not empty", allowedHosts().length > 0);

  await pipelineGuards();

  console.log(bad === 0 ? "\n✅ Portal guardrails hold." : `\n❌ ${bad} failed.`);
  process.exit(bad ? 1 : 0);
})();

// The pipeline, driven by a fake browser: no network, no portal, no account.
async function pipelineGuards() {
  console.log("\nWatching a page");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = mkdtempSync(join(tmpdir(), "beacon-portaltest-"));
  const dbPath = join(dir, "t.db");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: root, stdio: "ignore", env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });
  // lib/db is a singleton reading DATABASE_URL, so point the whole process at
  // the throwaway database before anything imports it.
  process.env.DATABASE_URL = `file:${dbPath}`;

  const { runPageJob } = await import("@/lib/knowledge/pagePipeline");
  const { setPortalEnabled } = await import("@/lib/portal/enabled");
  const { PROFILE_DIR } = await import("@/lib/portal/session");
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

  // A saved session has to look present for the gate under test to be the
  // portal toggle rather than the missing profile.
  mkdirSync(PROFILE_DIR, { recursive: true });

  let text = "First paragraph.\n\nSecond paragraph.";
  let opened = 0;
  const fakeBrowser = async () => {
    opened++;
    return {
      ctx: {
        async goto() { return { status: 200 }; },
        async content() {
          return {
            title: "Release notes",
            text,
            links: ["https://play.vidyard.com/watch/abc"],
            embeds: ["https://play.vidyard.com/embed/abc"],
          };
        },
        async wait() {},
      },
      async signedOut() { return false; },
      async close() {},
    };
  };

  const source = await prisma.knowledgeSource.create({
    data: { provider: "portal", kind: "page", externalId: "www.tagetik.com/notes",
            canonicalUrl: "https://www.tagetik.com/notes", title: "notes" },
  });
  const run = async (kind: string) => {
    const job = await prisma.researchJob.create({
      data: { sourceId: source.id, kind, stage: "fetch" },
    });
    await runPageJob({
      prisma: prisma as any,
      job: { id: job.id, sourceId: source.id, stage: "fetch", kind },
      workerId: "t",
      openBrowser: fakeBrowser as any,
    });
    // Exactly what the worker does in its finally block.
    await closeRun(prisma as any, job.id);
    return prisma.researchJob.findUnique({ where: { id: job.id } });
  };

  // 1. Off by default: no browser is ever opened.
  const blocked = await run("page");
  check("a run is refused while the portal toggle is off", blocked?.errorCode === "portal_disabled");
  check("no browser opens when it is off", opened === 0, `${opened} opened`);

  await setPortalEnabled(true);

  // 2. Preview reads the page but stores nothing — you have to be able to SEE
  //    the extracted text to judge it before committing.
  const dry = await run("page_dry");
  check("a preview stores nothing", dry?.errorCode === "preview");
  check("a preview creates no version",
    (await prisma.sourceVersion.count({ where: { sourceId: source.id } })) === 0);
  const previewDetail = JSON.parse(dry?.detail ?? "{}");
  check("a preview shows the extracted text",
    String(previewDetail.preview?.textSample ?? "").includes("First paragraph"));
  check("a preview counts the paragraphs", previewDetail.preview?.paragraphs === 2);
  check("a preview is still logged for audit", (previewDetail.log ?? []).length > 0);
  // The reason previews exist: on a webinar page this is where the video is.
  check("a preview reports the embedded player",
    (previewDetail.preview?.embeds ?? []).includes("https://play.vidyard.com/embed/abc"),
    JSON.stringify(previewDetail.preview?.embeds));
  check("a preview names the host it may not follow",
    (previewDetail.preview?.notFollowed ?? []).some((n: any) => n.host === "play.vidyard.com"));

  // 3. A real run stores the page.
  const first = await run("page");
  check("a real run succeeds", first?.state === "succeeded", String(first?.errorCode ?? ""));
  check("the page is stored as a version",
    (await prisma.sourceVersion.count({ where: { sourceId: source.id } })) === 1);
  check("every URL is logged for audit",
    (JSON.parse(first?.detail ?? "{}").log ?? []).some((e: any) => e.outcome === "fetched"));
  check("no model spend", (first?.spentMicroUsd ?? 0) === 0);

  // 4. An unchanged page costs nothing and creates nothing.
  const again = await run("page");
  check("re-checking an unchanged page succeeds", again?.state === "succeeded");
  check("an unchanged page creates NO new version",
    (await prisma.sourceVersion.count({ where: { sourceId: source.id } })) === 1);
  check("an unchanged page records no diff",
    (await prisma.analysisRevision.count()) === 0);

  // 5. A changed page produces a diff, still with no model call.
  text = "First paragraph.\n\nSecond paragraph, now reworded slightly.";
  const changed = await run("page");
  check("a changed page succeeds", changed?.state === "succeeded");
  check("a changed page creates a new version",
    (await prisma.sourceVersion.count({ where: { sourceId: source.id } })) === 2);
  const revision = await prisma.analysisRevision.findFirst({ where: { pipelineVersion: "diff" } });
  const changes = JSON.parse(revision?.summaryJson ?? "{}").changes ?? [];
  check("the reworded paragraph is detected",
    changes.some((c: any) => c.kind === "changed" && c.after.includes("reworded")), JSON.stringify(changes.map((c: any) => c.kind)));
  check("comparing still costs nothing", (changed?.spentMicroUsd ?? 0) === 0);

  // 6. What it did — the step log. A "current stage" column is useless after a
  //    run ends; the question is where it stopped and what it managed first.
  console.log("\nThe run log");
  {
    const stored = parseDetail(changed?.detail);
    const stages = (stored.steps ?? []).map((s) => s.stage);
    check("a run records every step it took",
      ["fetch", "store", "compare", "published"].every((x) => stages.includes(x)),
      stages.join(" → "));
    check("the steps are in order",
      stages.indexOf("fetch") < stages.indexOf("store") &&
        stages.indexOf("store") < stages.indexOf("compare"));
    check("each step is timestamped",
      (stored.steps ?? []).every((s) => !Number.isNaN(Date.parse(s.at))));
    check("a finished run leaves no step still running",
      (stored.steps ?? []).every((s) => s.state !== "running"));
    check("a step carries the number that explains it",
      (stored.steps ?? []).some((s) => (s.note ?? "").includes("paragraph")),
      JSON.stringify((stored.steps ?? []).map((s) => s.note)));
    // The merge: the page pipeline used to overwrite this column wholesale.
    check("the steps and the fetch log survive together",
      (stored.steps ?? []).length > 0 && (stored.log ?? []).length > 0);
  }

  // A run that stops early must keep BOTH, and say which step it stopped at —
  // the case the overwrite used to destroy.
  {
    await setPortalEnabled(false);
    const refused = await run("page");
    const stored = parseDetail(refused?.detail);
    const last = (stored.steps ?? [])[(stored.steps ?? []).length - 1];
    check("a refused run still records what it did", (stored.steps ?? []).length > 0,
      JSON.stringify((stored.steps ?? []).map((s) => s.stage)));
    check("it stopped at a named step, not nowhere", last?.stage === "check", last?.stage);
    check("the step is marked stopped, not left running",
      last?.state === "stopped", String(last?.state));
    check("and the step carries the reason",
      (last?.note ?? "").toLowerCase().includes("portal"), last?.note ?? "(none)");
    await setPortalEnabled(true);
  }

  // 7. Into the inbox. The Finding half is tested without a model call by
  //    driving the shared helper directly; the job wiring is tested by running
  //    it with no API key, which must stop cleanly rather than crash.
  console.log("\nInto the research inbox");
  const { upsertSourceFinding } = await import("@/lib/knowledge/finding");
  const { runPageAssessJob } = await import("@/lib/knowledge/assessPage");

  const item = {
    title: "Webinar: CapEx and workforce planning",
    summary: "A product demo covering capital expenditure and workforce planning.",
    rawContent: "body",
    sourceUrl: source.canonicalUrl,
    sourceType: "portal",
    sourceBody: "CCH Tagetik Community",
    relevance: "medium",
    relevanceReason: "Touches planning.",
    moduleNames: [] as string[],
  };

  await upsertSourceFinding(prisma as any, source.id, item);
  let finding = await prisma.finding.findUnique({
    where: { knowledgeSourceId: source.id },
  });
  check("a page lands in the inbox", Boolean(finding));
  check("it lands pending", finding?.status === "pending");
  check("it lands UNVERIFIED", finding?.verified === false);
  check("it carries the issuing site", finding?.sourceBody === "CCH Tagetik Community");
  check("it links back to the page", finding?.sourceUrl === source.canonicalUrl);

  // A human tick, then a re-assessment: the tick must not survive changed text.
  await prisma.finding.update({
    where: { id: finding!.id },
    data: { verified: true, verifiedRevision: finding!.contentRevision },
  });
  await upsertSourceFinding(prisma as any, source.id, {
    ...item,
    summary: "Reworded after a re-assessment.",
  });
  finding = await prisma.finding.findUnique({
    where: { knowledgeSourceId: source.id },
  });
  check("re-assessing does not create a second item",
    (await prisma.finding.count({ where: { knowledgeSourceId: source.id } })) === 1);
  check("re-assessing updates the existing one",
    finding?.summary === "Reworded after a re-assessment.");
  check("re-assessing clears a stale verification tick", finding?.verified === false);

  // A page with nothing stored cannot be assessed — there would be nothing to
  // send, and a model call on an empty page is money for nothing.
  const empty = await prisma.knowledgeSource.create({
    data: { provider: "portal", kind: "page", externalId: "www.tagetik.com/empty",
            canonicalUrl: "https://www.tagetik.com/empty", title: "empty" },
  });
  const emptyJob = await prisma.researchJob.create({
    data: { sourceId: empty.id, kind: "page_assess", stage: "summarise" },
  });
  await runPageAssessJob({
    prisma: prisma as any,
    job: { id: emptyJob.id, sourceId: empty.id, stage: "summarise", kind: "page_assess" },
    workerId: "t",
  });
  const emptyAfter = await prisma.researchJob.findUnique({ where: { id: emptyJob.id } });
  check("an unstored page is not assessed", emptyAfter?.errorCode === "no_version");
  check("and no inbox item is invented",
    (await prisma.finding.count({ where: { knowledgeSourceId: empty.id } })) === 0);

  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  rmSync(PROFILE_DIR, { recursive: true, force: true });
}
