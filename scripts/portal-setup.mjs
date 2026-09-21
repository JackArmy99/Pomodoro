// One-off setup for the portal browser. Run: npm run portal:setup
//
// Three jobs, in order, and the third is the point:
//   1. install the `playwright` package  — small, seconds
//   2. download Chromium                 — large, ~300MB, minutes
//   3. LAUNCH it and close it            — proof, not assurance
//
// Step 3 exists because this project has been bitten twice by "it installed, so
// it works". An install log is not evidence that a browser can start: npm can
// hold back the package's install scripts, or the browser download can be
// skipped, and both look like success. Launching prints a version number.
//
// Playwright is deliberately NOT in package.json — nobody who never touches the
// portal should pay 300MB for it. It is installed with --no-save, and a marker
// in the git-ignored storage/ directory records that this machine wants it, so
// `npm run update` can put it back (npm install prunes anything unsaved).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Not exported: importing this file would run it. The updater re-derives the
// same path rather than importing a script whose side effect is doing the work.
const MARKER = join(root, "storage", "portal-installed.json");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  return res.status === 0;
}

function heldBackScripts() {
  console.error(
    "\n⚠️  npm may be holding back this package's install scripts.\n" +
      "\nApprove it and run setup again:\n" +
      "   npm install-scripts approve playwright\n" +
      "   npm run portal:setup\n",
  );
}

async function main() {
  console.log("Setting up the portal browser (one-off, ~300MB).");

  // 1. The package. --no-save keeps it out of package.json on purpose.
  if (!run(npm, ["install", "--no-save", "playwright"])) {
    console.error("\n❌ Couldn't install the playwright package.");
    heldBackScripts();
    process.exit(1);
  }

  // 2. The browser itself. This is the big download; it lives in a user-level
  //    cache, not node_modules, so it survives npm install.
  if (!run(npx, ["playwright", "install", "chromium"])) {
    // Two very different causes, so name both rather than guessing: the real
    // message is printed above this line.
    console.error(
      "\n❌ Chromium didn't download. The message above says which of these it was:\n" +
        "   • the download was blocked (a proxy, VPN or firewall refusing\n" +
        "     cdn.playwright.dev) — try off the corporate network, or\n" +
        "   • npm is holding back install scripts:\n" +
        "        npm install-scripts approve playwright\n" +
        "\nThen run:  npm run portal:setup\n",
    );
    process.exit(1);
  }

  // 3. Prove it. An install that was never exercised proves nothing.
  console.log("\nChecking the browser actually starts…");
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    console.log(`\n✅ Chromium ${browser.version()} started and closed cleanly.`);
  } catch (err) {
    const message = String(err?.message ?? err);
    console.error(`\n❌ The browser did not start:\n${message.slice(0, 600)}`);
    if (/Executable doesn't exist|please run|install chromium/i.test(message)) {
      console.error(
        "\nThe package is there but the browser binary isn't. Run:\n" +
          "   npx playwright install chromium\n",
      );
    } else {
      heldBackScripts();
    }
    process.exit(1);
  } finally {
    await browser?.close().catch(() => {});
  }

  // 4. Remember, so an update can put it back.
  mkdirSync(dirname(MARKER), { recursive: true });
  writeFileSync(MARKER, JSON.stringify({ installedAt: new Date().toISOString() }, null, 2));

  console.log("\nNext:  npm run portal:login   (you sign in; the session is reused)");
}

if (!existsSync(join(root, "package.json"))) {
  console.error("Run this from the project folder.");
  process.exit(1);
}
main();
