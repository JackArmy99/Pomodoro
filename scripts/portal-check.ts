// Is the saved portal session still valid? Run: npm run portal:check
//
// Fetches one page and reports what it sees. Retrieves nothing else and stores
// nothing — this exists so "is it signed in?" never has to be guessed at.
import { checkUrl } from "../lib/portal/allowlist";
import { hasProfile, openContext, inspectProfile, PROFILE_DIR } from "../lib/portal/session";

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
    const title = await page.title();
    // A visible password box is the clearest sign we are looking at a login
    // page rather than the content behind it.
    const passwordBoxes = await page.locator('input[type="password"]:visible').count();
    const cookies = await context.cookies();

    console.log(`\nCookies stored: ${cookies.length}`);
    console.log(`URL:    ${url}`);
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
