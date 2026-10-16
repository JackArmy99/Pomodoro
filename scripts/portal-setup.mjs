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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Not exported: importing this file would run it. The updater re-derives the
// same path rather than importing a script whose side effect is doing the work.
const MARKER = join(root, "storage", "portal-installed.json");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

// Every optional add-on, installed in ONE command. npm treats any unsaved
// package as clutter and prunes it on the next install — installing the
// speech-to-text pieces on their own silently removed Playwright. Together,
// always; and the updater restores them together too.
//   playwright                — the browser that reads the portal
//   ffmpeg-static             — pulls the audio out of a webinar video
//   @huggingface/transformers — runs Whisper (speech-to-text) on this machine
const ADDONS = ["playwright", "ffmpeg-static", "@huggingface/transformers"];

function installedVersion(name) {
  try {
    return JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

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
  console.log("Setting up the portal browser and webinar transcription (one-off, ~400MB).");

  // 1. The packages, together. --no-save keeps them out of package.json.
  if (!run(npm, ["install", "--no-save", ...ADDONS])) {
    console.error("\n❌ Couldn't install the add-ons.");
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

  // 3b. Prove the audio converter runs too — same rule as the browser.
  try {
    const mod = await import("ffmpeg-static");
    const ffmpeg = mod.default ?? mod;
    const res = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
    if (res.status !== 0) throw new Error(res.stderr || "ffmpeg did not run");
    console.log(`✅ Audio converter works (${(res.stdout.split("\n")[0] || "ffmpeg").slice(0, 60)}).`);
  } catch (err) {
    console.error(`\n❌ The audio converter (ffmpeg) didn't run: ${String(err?.message ?? err).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(
    "   Speech-to-text: the Whisper model (~250MB) downloads the first time a\n" +
      "   webinar is transcribed, into storage/whisper-models, and is kept.",
  );

  // 4. Remember, so an update can put them back — with EXACT versions. The
  // browser download is tied to one Playwright release: restoring plain
  // "playwright" got a newer release that wanted a browser build nobody had
  // downloaded ("Executable doesn't exist").
  mkdirSync(dirname(MARKER), { recursive: true });
  const addons = Object.fromEntries(ADDONS.map((n) => [n, installedVersion(n)]));
  writeFileSync(
    MARKER,
    JSON.stringify(
      // `version` kept for older updaters that only knew about Playwright.
      { installedAt: new Date().toISOString(), version: addons.playwright, addons },
      null,
      2,
    ),
  );

  console.log("\nNext:  npm run portal:login   (you sign in; the session is reused)");
}

if (!existsSync(join(root, "package.json"))) {
  console.error("Run this from the project folder.");
  process.exit(1);
}
main();
