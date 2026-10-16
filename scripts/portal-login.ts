// Sign in to the Tagetik portal, yourself, in a real browser window.
// Run: npm run portal:login  [start-url]
//
// Beacon never sees, types or stores your password. This opens a separate
// browser window (titled "… Google Chrome for Testing"); you sign in as you
// always would; the session that produces is saved locally so later runs can
// reuse it. Nothing about the sign-in is automated, which is what keeps this
// working if the portal ever adds SSO or 2FA.
//
// It notices the sign-in by itself — no "come back and press Enter". That step
// was easy to miss (the window can open BEHIND the terminal), and it could not
// work at all when a Claude session started the script.
//
// It then CLOSES the browser and opens it again, and checks the sign-in is still
// there. A login that only lasts while the window is open is useless to an
// agent that opens its own browser later — and it looks exactly like success
// until the first real run.
import { checkUrl } from "../lib/portal/allowlist";
import { openContext, looksLikeLoginUrl, saveSession, PROFILE_DIR } from "../lib/portal/session";

// A members-only page, so an expired session lands straight on the login form
// (the homepage loads signed-out and gives no prompt to sign in).
const url =
  process.argv[2] || process.env.PORTAL_START_URL || "https://community.tagetik.com/library";

const WAIT_MINUTES = 10;

async function onLoginPage(page: any): Promise<boolean> {
  if (looksLikeLoginUrl(page.url())) return true;
  try {
    return (await page.locator('input[type="password"]:visible').count()) > 0;
  } catch {
    return true; // mid-navigation — treat as not signed in yet
  }
}

async function main() {
  // The same allowlist the agent uses — one copy, so the two can never drift.
  const verdict = checkUrl(url);
  if (!verdict.ok) {
    console.error(`\n❌ ${verdict.reason}`);
    console.error(
      "\nAdd the host to PORTAL_ALLOWED_HOSTS in .env if it is genuinely part " +
        "of the portal.",
    );
    process.exit(1);
  }

  console.log(`\nOpening a browser window at ${url}`);
  console.log('Look for a window titled "… Google Chrome for Testing" — it may be');
  console.log("behind this one. Sign in there as you normally would.");
  console.log(`This notices when you're done (waits up to ${WAIT_MINUTES} minutes).\n`);

  // 1. Jack signs in, in a visible window.
  let context = await openContext({ headed: true });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.bringToFront().catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    if (!(await onLoginPage(page))) {
      console.log("Already signed in.");
    } else {
      const deadline = Date.now() + WAIT_MINUTES * 60_000;
      let signedIn = false;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        if (!(await onLoginPage(page))) {
          // Let the site finish whatever it does after login before saving.
          await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
          if (!(await onLoginPage(page))) {
            signedIn = true;
            break;
          }
        }
      }
      if (!signedIn) {
        console.log(`\n⚠️  No sign-in within ${WAIT_MINUTES} minutes. Run this again when ready.`);
        process.exitCode = 1;
        return;
      }
      console.log("✅ Signed in.");
    }

    // Keep the session ourselves: the site's login cookie is session-only and
    // would vanish when this window closes. Names are printed so it's clear
    // where the login lives; values never are.
    const shape = await saveSession(context, page);
    console.log("\nSaved the session (names only, never values):");
    console.log(`  session-only cookies: ${shape.sessionOnlyCookies.join(", ") || "none"}`);
    console.log(`  sessionStorage keys:  ${shape.sessionKeys.join(", ") || "none"}`);
    console.log(`  localStorage keys:    ${shape.localKeys.join(", ") || "none"}`);
  } finally {
    await context.close();
  }

  // 2. Does it survive the browser closing? That is what the agent depends on.
  console.log("\nChecking the sign-in survives closing the browser…");
  context = await openContext({ headed: false });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    if (await onLoginPage(page)) {
      console.log(
        "\n❌ The portal forgot the sign-in as soon as the browser closed.\n" +
          "   Its login only lasts while a window stays open. Tell Claude —\n" +
          "   Beacon needs to keep that session itself.",
      );
      process.exitCode = 1;
    } else {
      console.log(
        `\n✅ Still signed in after a restart — Beacon can use it.\n` +
          `   Saved in ${PROFILE_DIR}\n` +
          "   Check it any time with:  npm run portal:check",
      );
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("\n" + String(err?.message ?? err));
  process.exit(1);
});
