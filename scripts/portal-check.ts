// Is the saved portal session still valid? Run: npm run portal:check
//
// Fetches one page and reports what it sees. Retrieves nothing else and stores
// nothing — this exists so "is it signed in?" never has to be guessed at.
import { checkUrl } from "../lib/portal/allowlist";
import { hasProfile, openContext } from "../lib/portal/session";

const url =
  process.argv[2] || process.env.PORTAL_START_URL || "https://community.tagetik.com/";

async function main() {
  const verdict = checkUrl(url);
  if (!verdict.ok) {
    console.error(`❌ ${verdict.reason}`);
    process.exit(1);
  }

  if (!hasProfile()) {
    console.log("No saved session yet. Run:  npm run portal:login");
    process.exit(1);
  }

  const context = await openContext({ headed: false });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? null;
    const title = await page.title();
    // A visible password box is the clearest sign we are looking at a login
    // page rather than the content behind it.
    const passwordBoxes = await page.locator('input[type="password"]:visible').count();

    console.log(`\nURL:    ${url}`);
    console.log(`Status: ${status}`);
    console.log(`Title:  ${title}`);
    console.log(
      passwordBoxes > 0
        ? "\n🔒 A sign-in form is showing — the session has expired. Run:  npm run portal:login"
        : "\n✅ Signed in (no sign-in form on that page).",
    );
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("\n" + String(err?.message ?? err));
  process.exit(1);
});
