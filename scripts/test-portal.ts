// Guardrails for the portal agent. No network, no browser, no portal account —
// these are the rules, tested as rules. Run: npm run test:portal
import { checkUrl, permittedLinks, allowedHosts } from "@/lib/portal/allowlist";
import { createReader, Blocked, CapReached } from "@/lib/portal/fetch";

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

  console.log(bad === 0 ? "\n✅ Portal guardrails hold." : `\n❌ ${bad} failed.`);
  process.exit(bad ? 1 : 0);
})();
