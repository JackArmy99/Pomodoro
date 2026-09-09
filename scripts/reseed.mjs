// Re-seed the database from prisma/client-modules.json.
//
// IMPORTANT: seeding WIPES everything first — clients, tasks, briefs,
// opportunities, findings, agents. On a fresh (empty) database that's harmless,
// so it runs straight through. If there's already data, this takes a backup and
// makes you type RESEED before anything is deleted.
//
// Run: npm run db:reseed        (add --force to skip the prompt, e.g. in CI)
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

async function countExisting() {
  const prisma = new PrismaClient();
  try {
    const [clients, tasks, briefs, findings] = await Promise.all([
      prisma.client.count(),
      prisma.task.count(),
      prisma.brief.count(),
      prisma.finding.count(),
    ]);
    return { clients, tasks, briefs, findings };
  } finally {
    await prisma.$disconnect();
  }
}

// A brand-new database has no tables yet — treat that as empty.
const counts = await countExisting().catch(() => ({
  clients: 0,
  tasks: 0,
  briefs: 0,
  findings: 0,
}));
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (total === 0) {
  console.log("Database is empty — seeding the starter data.\n");
  run("npx", ["prisma", "db", "seed"]);
  process.exit(0);
}

console.log("\n⚠️  Re-seeding DELETES everything currently in the database.\n");
console.log(`   Clients:       ${counts.clients}`);
console.log(`   Tasks:         ${counts.tasks}`);
console.log(`   Briefs:        ${counts.briefs}`);
console.log(`   Findings:      ${counts.findings}\n`);

if (!force) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type RESEED to confirm (anything else cancels): ');
  rl.close();
  if (answer.trim() !== "RESEED") {
    console.log("\nCancelled — nothing was changed.");
    process.exit(0);
  }
}

console.log("\nTaking a backup first…");
run("node", ["scripts/backup.mjs"]);

console.log("\nSeeding…");
run("npx", ["prisma", "db", "seed"]);
console.log("\nDone. If that was a mistake, restore the backup listed above.");
