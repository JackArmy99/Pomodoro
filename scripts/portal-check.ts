// Is the saved portal session still valid? Run: npm run portal:check
//
// Fetches one page and reports what it sees. Retrieves nothing else and stores
// nothing — this exists so "is it signed in?" never has to be guessed at.
import { checkUrl } from "../lib/portal/allowlist";
import {
  hasProfile,
  openContext,
  inspectProfile,
  looksLikeLoginUrl,
  PROFILE_DIR,
} from "../lib/portal/session";

// The Library, not the homepage. The homepage loads without signing in, so
// checking it reported "signed in" while every real page was redirecting to the
// login form — a check that could only ever pass.
const url =
  process.argv[2] ||
  process.env.PORTAL_CHECK_URL ||
  "https://community.tagetik.com/library";

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

  // Answer "is my password in there?" with evidence, before anything else.
  const profile = inspectProfile();
  console.log(`\nProfile: ${PROFILE_DIR}`);
  console.log(
    profile.savedPasswords === null
      ? "Saved passwords: couldn't read the browser's store (it may be locked)."
      : `Saved passwords in this profile: ${profile.savedPasswords}`,
  );
  if (profile.savedPasswords && profile.savedPasswords > 0) {
    console.log(
      "   That's Chromium's own password manager, not Beacon. Clear it with:  npm run portal:forget",
    );
  }

  // Is the browser itself actually there? The package can be installed while
  // the Chromium binary never downloaded — two different failures that look
  // identical until one of them is named.
  let context;
  try {
    context = await openContext({ headed: false });
  } catch (err: any) {
    const message = String(err?.message ?? err);
    if (/Executable doesn't exist|playwright install/i.test(message)) {
      console.error(
        "\n❌ The playwright package is installed but the browser binary isn't." +
          "\n\nRun:  npm run portal:setup\n",
      );
      process.exit(1);
    }
    throw err;
  }

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? null;
    // The site is a JavaScript app: an expired session shows "Please wait" and
    // only THEN redirects to the login page. Judge the page once it has settled.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const landed = page.url();
    const title = await page.title();
    const passwordBoxes = await page.locator('input[type="password"]:visible').count();
    const signedOut = looksLikeLoginUrl(landed) || passwordBoxes > 0;
    const cookies = await context.cookies();

    console.log(`\nCookies stored: ${cookies.length}`);
    console.log(`Checked: ${url}`);
    if (landed !== url) console.log(`Landed:  ${landed}`);
    console.log(`Status:  ${status}`);
    console.log(`Title:   ${title}`);
    console.log(
      signedOut
        ? "\n🔒 Not signed in — the portal sent us to its login page. Run:  npm run portal:login"
        : "\n✅ Signed in — a members-only page loaded without a login form.",
    );
    if (signedOut) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("\n" + String(err?.message ?? err));
  process.exit(1);
});
