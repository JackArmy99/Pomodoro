// Sign in to the Tagetik portal, yourself, in a real browser window.
// Run: npm run portal:login  [start-url]
//
// Beacon never sees, types or stores your password. This opens a normal browser
// window; you sign in as you always would; the session that produces is saved
// locally so later runs can reuse it. Nothing about the sign-in is automated,
// which is what keeps this working if the portal ever adds SSO or 2FA.
import { createInterface } from "node:readline";
import { checkUrl } from "../lib/portal/allowlist.ts";
import { openContext, PROFILE_DIR } from "../lib/portal/session.ts";

const url =
  process.argv[2] || process.env.PORTAL_START_URL || "https://www.tagetik.com";

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

  console.log(`\nOpening a browser at ${url}`);
  console.log("Sign in as you normally would, then come back to this window.\n");

  const context = await openContext({ headed: true });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded" });

    await new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question("Press Enter once you are signed in… ", () => {
        rl.close();
        resolve(null);
      });
    });

    const cookies = await context.cookies();
    console.log(
      cookies.length > 0
        ? `\n✅ Session saved to ${PROFILE_DIR}\n   Check it any time with:  npm run portal:check`
        : "\n⚠️  No cookies were saved — that usually means the sign-in didn't complete.",
    );
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("\n" + String(err?.message ?? err));
  process.exit(1);
});
