import { prisma } from "@/lib/db";

// Portal retrieval is off until it is deliberately switched on. The toggle's
// label is the record of Jack's confirmation that automated access is permitted
// under the Wolters Kluwer agreement — asked once, recorded, not raised again.
export const PORTAL_ENABLED_KEY = "portal_enabled";

export async function portalEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({
    where: { key: PORTAL_ENABLED_KEY },
  });
  return row?.value === "true";
}

export async function setPortalEnabled(on: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: PORTAL_ENABLED_KEY },
    create: { key: PORTAL_ENABLED_KEY, value: on ? "true" : "false" },
    update: { value: on ? "true" : "false" },
  });
}
