// Non-destructive: add any code-named clients that aren't already in the
// database, without touching existing data. Safe to run repeatedly — it skips
// names that already exist. Run with: npm run clients:add
import { PrismaClient } from "@prisma/client";
import { CODE_NAMES, colorFor } from "../prisma/codenames.mjs";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.client.findMany({ select: { name: true } });
  const have = new Set(existing.map((c) => c.name.toUpperCase()));

  let added = 0;
  for (let i = 0; i < CODE_NAMES.length; i++) {
    const name = CODE_NAMES[i];
    if (have.has(name.toUpperCase())) continue;
    await prisma.client.create({
      data: { name, type: "active", color: colorFor(i) },
    });
    added++;
  }

  console.log(
    added > 0
      ? `Added ${added} new client(s).`
      : "All code names already present — nothing to add.",
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
