// Save a timestamped copy of the local database, so you always have a restore
// point. Run: npm run backup
// The backup files live in prisma/backups/ and are NOT committed to git.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = join(root, "prisma", "dev.db");
const backupDir = join(root, "prisma", "backups");

if (!existsSync(db)) {
  console.error(
    "No database found at prisma/dev.db — nothing to back up. Run `npm run setup` first.",
  );
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const now = new Date();
const stamp = now
  .toISOString()
  .replace(/[:.]/g, "-")
  .replace("T", "_")
  .slice(0, 19);
const dest = join(backupDir, `dev-${stamp}.db`);
copyFileSync(db, dest);

const count = readdirSync(backupDir).filter((f) => f.endsWith(".db")).length;
console.log(`Backup saved: prisma/backups/dev-${stamp}.db`);
console.log(`You now have ${count} backup(s).`);
console.log(
  "To restore one: stop the app, then copy a backup file over prisma/dev.db.",
);
