// One-word updater: safely pull the latest code and apply database changes
// WITHOUT losing your data. Run: npm run update  (then: npm run dev)
//
// Steps:
//   0. Check nothing is still running (Windows locks files that are in use).
//   1. Back up the database first (safety net).
//   2. Discard npm's automatic scribble on package.json (it blocks git pull).
//   3. git pull the latest code.
//   4. Install any new dependencies.
//   5. Hand over to the JUST-PULLED copy of this script (see note below), which
//      repairs the migration ledger if needed, migrates, and regenerates.
//
// Why the hand-over: Node reads this file into memory when the command starts,
// so step 3 replaces it on disk but NOT in the running process. Anything after
// the pull would still be the old code — which is exactly how a migration fix
// shipped in the same commit silently failed to run. Re-running the post-pull
// half as a fresh child process is the fix: the child loads the new file.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Prisma advertises major-version upgrades on every command. We are pinned to
// 5.22 on purpose, so hide the nag rather than dangle it mid-error.
const childEnv = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" };

// `stdio: "inherit"` sends a command's errors straight to the terminal, which
// means the thrown error only says "Command failed" — we can't tell a file lock
// from anything else. For the steps where that distinction matters, capture
// stderr instead and print it ourselves. (Stderr on a *successful* run is
// dropped; Prisma reports success on stdout, so nothing useful is lost.)
function run(cmd, { captureErrors = false } = {}) {
  const stdio = captureErrors ? ["inherit", "inherit", "pipe"] : "inherit";
  try {
    execSync(cmd, { stdio, cwd: root, env: childEnv });
  } catch (err) {
    if (err?.stderr) process.stderr.write(err.stderr);
    throw err;
  }
}

// Which step we're on, so a failure can say what was happening in plain English.
let currentStep = "starting up";

function step(msg) {
  currentStep = msg;
  console.log(`\n=== ${msg} ===`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isFileLock = (err) =>
  /EPERM|EBUSY|EACCES/.test(
    `${err?.message ?? err} ${err?.stderr ?? ""} ${err?.stdout ?? ""}`,
  );

// Windows refuses to replace a file another process has open, and a running
// Beacon holds the Prisma query engine. Those locks clear within a second or
// two once the other process lets go, so it's worth waiting rather than failing.
async function runWithRetry(cmd, { attempts = 3, delayMs = 2000 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      run(cmd, { captureErrors: true });
      return;
    } catch (err) {
      if (i === attempts || !isFileLock(err)) throw err;
      console.log(`\nA file is still in use — waiting ${delayMs / 1000}s and trying again (${i}/${attempts - 1})…`);
      await sleep(delayMs);
    }
  }
}

// Is something answering on the dev-server port? Cheap, zero-dependency probe.
function somethingOnPort(port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

// The half that must run on freshly pulled code.
async function postPull() {
  // Repair a wedged migration ledger, if there is one (no-op when healthy).
  //
  // This MUST be a child process, not an import. The repair opens a
  // PrismaClient, which loads the native query-engine DLL into whichever
  // process runs it — and Node never unloads a native addon, so `$disconnect()`
  // closes the connection but not the file handle. `prisma generate` below
  // replaces that exact DLL; on Windows a rename over a file this process still
  // holds open fails with EPERM, forever, no matter what else is closed.
  run(`node "${join(root, "scripts", "fix-migrations.mjs")}"`);

  step("Updating the database (keeping your data)");
  run("npx prisma migrate deploy");

  step("Finishing up");
  await runWithRetry("npx prisma generate");
}

try {
  if (process.argv.includes("--post-pull")) {
    await postPull();
  } else {
    // 0. Refuse to start while Beacon is running — otherwise the update does all
    //    its work and then falls over on the very last step.
    if (!process.argv.includes("--force") && (await somethingOnPort(3000))) {
      console.error(
        "\n⚠️  Beacon looks like it's still running on http://localhost:3000.\n" +
          "\nWindows won't let us replace files that a running app has open, so the\n" +
          "update would fail at the end. Press Ctrl+C in that window (or close it),\n" +
          "then run:  npm run update\n",
      );
      process.exit(1);
    }

    // 1. Back up the database.
    const db = join(root, "prisma", "dev.db");
    if (existsSync(db)) {
      step("Backing up your database");
      const backupDir = join(root, "prisma", "backups");
      mkdirSync(backupDir, { recursive: true });
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);
      copyFileSync(db, join(backupDir, `dev-${stamp}.db`));
      console.log(`Saved prisma/backups/dev-${stamp}.db`);
    }

    // 2. Discard npm's automatic edits to package files (safe — the repo copies
    //    win). npm rewrites both of these locally, and either blocks git pull.
    step("Tidying package files");
    run("git restore package.json package-lock.json");

    // 3. Pull the latest code.
    step("Pulling latest code");
    run("git pull");

    // 4. Install any new dependencies.
    step("Installing dependencies");
    run("npm install");

    // 5. Continue in a fresh process so the rest runs the code just pulled.
    //    It explains its own failures, so don't print a second message here.
    try {
      run(`node "${join(root, "scripts", "update.mjs")}" --post-pull`);
    } catch {
      process.exit(1);
    }

    console.log("\n✅ Update complete. Now run:  npm run dev");
  }
} catch (err) {
  if (isFileLock(err)) {
    console.error(
      `\n❌ Couldn't finish "${currentStep}" — a file is being used by another program.\n` +
        "\nThis is almost always Beacon still running somewhere. Close any window\n" +
        "running  npm run dev ,  npm run dev:all ,  npm run worker  or  npx prisma studio ,\n" +
        "then run:  npm run update\n" +
        "\nNothing is lost — your database is already up to date. Only the database\n" +
        "client needs regenerating, which that re-run will do.\n",
    );
  } else {
    console.error(
      `\n❌ Update hit a snag during "${currentStep}".\n` +
        "Copy the message above and send it to Claude.",
    );
  }
  process.exit(1);
}
