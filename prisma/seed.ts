import { PrismaClient } from "@prisma/client";
import { CODE_NAMES, colorFor } from "./codenames.mjs";

const prisma = new PrismaClient();

async function main() {
  // Clean slate so re-seeding is predictable.
  await prisma.task.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.briefClient.deleteMany();
  await prisma.brief.deleteMany();
  await prisma.person.deleteMany();
  await prisma.client.deleteMany();

  // Load the real client list — code names only. All active by default;
  // change any to "prospect" in the app, or tell Claude which ones are prospects.
  for (let i = 0; i < CODE_NAMES.length; i++) {
    await prisma.client.create({
      data: { name: CODE_NAMES[i], type: "active", color: colorFor(i) },
    });
  }

  console.log(`Seeded ${CODE_NAMES.length} clients (code names).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
