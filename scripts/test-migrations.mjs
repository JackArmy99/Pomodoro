// Prove the migration history applies cleanly to an EMPTY database — exactly
// what a new machine (or `npm run setup`) does. This is the gate that catches
// out-of-order migrations, which a machine that already has the columns will
// never hit. Run: npm run test:migrations
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "beacon-migtest-"));
const dbPath = join(dir, "fresh.db");

console.log("Applying every migration to a brand-new empty database…\n");
try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });
  console.log("\n✅ A fresh database migrates cleanly — new installs will work.");
} catch {
  console.error(
    "\n❌ A fresh database FAILS to migrate. New installs are broken.\n" +
      "   Usually this means migrations are out of order: a later-named migration\n" +
      "   adds something an earlier-named one already depends on. Fix the order\n" +
      "   (rename), don't edit a migration that has already been applied.",
  );
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
