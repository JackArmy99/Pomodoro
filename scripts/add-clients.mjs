// Non-destructive: add any clients from the mapping data that aren't already in
// the database, without touching existing data. Safe to run repeatedly — it
// skips names that already exist. Adds clients only (not module mappings).
// Run with: npm run clients:add
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { colorFor } from "../prisma/palette.mjs";

const prisma = new PrismaClient();

function loadData() {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(
    readFileSync(join(here, "../prisma/client-modules.json"), "utf8"),
  );
}

async function main() {
  const data = loadData();
  const existing = await prisma.client.findMany({ select: { name: true } });
  const have = new Set(existing.map((c) => c.name.toUpperCase()));

  let added = 0;
  for (let i = 0; i < data.order.length; i++) {
    const name = data.order[i];
    if (have.has(name.toUpperCase())) continue;
    await prisma.client.create({
      data: { name, type: "active", color: colorFor(i) },
    });
    added++;
  }

  console.log(
    added > 0
      ? `Added ${added} new client(s).`
      : "All clients already present — nothing to add.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
