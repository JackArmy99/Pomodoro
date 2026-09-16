// One-word updater: safely pull the latest code and apply database changes
// WITHOUT losing your data. Run: npm run update  (then: npm run dev)
//
// Steps:
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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => execSync(cmd, { stdio: "inherit", cwd: root });

function step(msg) {
  console.log(`\n=== ${msg} ===`);
}

// The half that must run on freshly pulled code.
async function postPull() {
  // Repair a wedged migration ledger, if there is one (no-op when healthy).
  const { fixMigrations } = await import("./fix-migrations.mjs");
  await fixMigrations();

  step("Updating the database (keeping your data)");
  run("npx prisma migrate deploy");

  step("Finishing up");
  run("npx prisma generate");
}

try {
  if (process.argv.includes("--post-pull")) {
    await postPull();
  } else {
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
    run(`node "${join(root, "scripts", "update.mjs")}" --post-pull`);

    console.log("\n✅ Update complete. Now run:  npm run dev");
  }
} catch (err) {
  console.error(
    "\n❌ Update hit a snag. Copy the message above and send it to Claude.",
  );
  process.exit(1);
}
