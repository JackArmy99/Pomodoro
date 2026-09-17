// Guardrails for the portal agent. No network, no browser, no portal account —
// these are the rules, tested as rules. Run: npm run test:portal
import { checkUrl, permittedLinks, allowedHosts } from "@/lib/portal/allowlist";
import { createReader, Blocked, CapReached } from "@/lib/portal/fetch";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

let bad = 0;
const check = (n: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${d ? " — " + d : ""}`);
  if (!ok) bad++;
};

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

console.log("\nReading pages");
function fakeBrowser(status: number | null = 200) {
  const visited: string[] = [];
  return {
    visited,
    ctx: {
      async goto(url: string) { visited.push(url); return { status }; },
      async content() { return { title: "T", text: "body text", links: [] }; },
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
        async content() { return { title: "Release notes", text, links: [] }; },
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
    return prisma.researchJob.findUnique({ where: { id: job.id } });
  };

  // 1. Off by default: no browser is ever opened.
  const blocked = await run("page");
  check("a run is refused while the portal toggle is off", blocked?.errorCode === "portal_disabled");
  check("no browser opens when it is off", opened === 0, `${opened} opened`);

  await setPortalEnabled(true);

  // 2. Dry run retrieves nothing.
  const dry = await run("page_dry");
  check("a dry run stores nothing", dry?.errorCode === "dry_run");
  check("a dry run creates no version",
    (await prisma.sourceVersion.count({ where: { sourceId: source.id } })) === 0);
  check("a dry run still logs its intent", Boolean(dry?.detail));

  // 3. A real run stores the page.
  const first = await run("page");
  check("a real run succeeds", first?.state === "succeeded", String(first?.errorCode ?? ""));
  check("the page is stored as a version",
    (await prisma.sourceVersion.count({ where: { sourceId: source.id } })) === 1);
  check("every URL is logged for audit", Boolean(first?.detail) && first!.detail!.includes("fetched"));
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

  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  rmSync(PROFILE_DIR, { recursive: true, force: true });
}
