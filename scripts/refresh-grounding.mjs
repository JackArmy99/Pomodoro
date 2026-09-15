// Load the latest starter module descriptions + Module Opportunities briefing
// into an existing database, WITHOUT overwriting anything you've edited yourself.
// A module is updated only if its description is still empty or the original
// starter text. Run: npm run refresh:grounding
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  MODULE_DESCRIPTIONS,
  OLD_MODULE_DESCRIPTIONS,
  MODULES_BRIEFING,
  OLD_MODULES_BRIEFING,
} from "../prisma/grounding.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prisma = new PrismaClient();

// Back up first (same as npm run backup) — a safety net.
const db = join(root, "prisma", "dev.db");
if (existsSync(db)) {
  const backupDir = join(root, "prisma", "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  copyFileSync(db, join(backupDir, `dev-${stamp}.db`));
  console.log(`Backup saved: prisma/backups/dev-${stamp}.db`);
}

let updated = 0;
let skipped = 0;
for (const [name, description] of Object.entries(MODULE_DESCRIPTIONS)) {
  const mod = await prisma.module.findUnique({ where: { name } });
  if (!mod) continue;
  const current = mod.description?.trim() ?? "";
  const unedited = current === "" || current === (OLD_MODULE_DESCRIPTIONS[name] ?? "").trim();
  if (unedited) {
    await prisma.module.update({ where: { name }, data: { description } });
    updated += 1;
  } else {
    skipped += 1;
    console.log(`Kept your edited description for "${name}".`);
  }
}

// Refresh the Module Opportunities briefing only if it is still the original.
const agent = await prisma.agent.findUnique({ where: { id: "agent_modules" } });
if (agent && agent.briefing.trim() === OLD_MODULES_BRIEFING.trim()) {
  await prisma.agent.update({ where: { id: "agent_modules" }, data: { briefing: MODULES_BRIEFING } });
  console.log("Updated the Module Opportunities briefing.");
} else if (agent) {
  console.log("Kept your edited Module Opportunities briefing.");
}

console.log(`\nDescriptions: ${updated} refreshed, ${skipped} kept (your edits).`);
console.log("Fine-tune any of them in the app on /modules.");
await prisma.$disconnect();
