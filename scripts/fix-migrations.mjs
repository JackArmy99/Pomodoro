// Repair a migration ledger left in a failed state, so `npm run update` can
// carry on. Does nothing on a healthy machine.
//
// The one case this handles: `revision_aware_verification` was published with a
// timestamp that sorted AFTER `add_knowledge_base`, whose table rebuild already
// created the same columns. Machines that applied them in name order hit
// "duplicate column name: contentRevision" and Prisma then blocks every later
// migration (P3018). The columns ARE present, so the honest repair is to tell
// Prisma that migration is satisfied — not to touch any data.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OLD_NAME = "20260916090000_revision_aware_verification";
const NEW_NAME = "20260915142500_revision_aware_verification";

function resolve(flag, name) {
  execFileSync("npx", ["prisma", "migrate", "resolve", flag, name], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

export async function fixMigrations({ quiet = false } = {}) {
  if (!existsSync(join(root, "prisma", "dev.db"))) return; // nothing to repair

  const prisma = new PrismaClient();
  try {
    // Is the ledger even present? A brand-new database has no _prisma_migrations.
    const ledger = await prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'`,
    );
    if (!Array.isArray(ledger) || ledger.length === 0) return;

    const failed = await prisma.$queryRawUnsafe(
      `SELECT migration_name FROM _prisma_migrations
       WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    );
    const failedNames = (failed ?? []).map((r) => r.migration_name);

    // Do the columns that migration would add already exist?
    const cols = await prisma.$queryRawUnsafe(`PRAGMA table_info("Finding")`);
    const hasColumn = (cols ?? []).some((c) => c.name === "contentRevision");

    const applied = await prisma.$queryRawUnsafe(
      `SELECT migration_name FROM _prisma_migrations
       WHERE migration_name = ? AND finished_at IS NOT NULL`,
      NEW_NAME,
    );
    const newAlreadyApplied = Array.isArray(applied) && applied.length > 0;

    await prisma.$disconnect();

    if (!failedNames.includes(OLD_NAME) && (newAlreadyApplied || !hasColumn)) {
      return; // healthy — nothing to do
    }

    if (!quiet) {
      console.log(
        "\n=== Repairing the migration history (your data is not touched) ===",
      );
    }

    // 1. Clear the failed record for the old, mis-ordered name.
    if (failedNames.includes(OLD_NAME)) {
      console.log(`Clearing the failed record for ${OLD_NAME}…`);
      resolve("--rolled-back", OLD_NAME);
    }

    // 2. The renamed migration's columns are already in the table, so record it
    //    as applied rather than running it again (which is what failed).
    if (hasColumn && !newAlreadyApplied) {
      console.log(`Recording ${NEW_NAME} as already applied…`);
      resolve("--applied", NEW_NAME);
    }

    console.log("Migration history repaired.\n");
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

// Allow running it directly: node scripts/fix-migrations.mjs
if (process.argv[1] && process.argv[1].endsWith("fix-migrations.mjs")) {
  fixMigrations().catch((err) => {
    console.error("Could not repair the migration history:", err.message);
    process.exit(1);
  });
}
