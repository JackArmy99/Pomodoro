import { prisma } from "@/lib/db";
import { parseDetail } from "@/lib/knowledge/runLog";
import { DISMISSED_KEY, type LibraryItem } from "@/lib/portal/library";

// The webinar shortlist: what the latest Library check listed, minus anything
// Beacon already holds and anything Jack said no to. Worked out on every read,
// so it is never stale. Shared by Library and Home.
export async function webinarShortlist() {
  const [listing, dismissedRow] = await Promise.all([
    prisma.knowledgeSource.findFirst({
      where: { kind: "library" },
      include: { jobs: { orderBy: { createdAt: "desc" }, take: 5 } },
    }),
    prisma.setting.findUnique({ where: { key: DISMISSED_KEY } }),
  ]);
  const lastScan = listing?.jobs[0] ?? null;
  const scanning = !!lastScan && ["queued", "running", "retry_wait"].includes(lastScan.state);
  const lastGood = listing?.jobs.find((j) => j.state === "succeeded") ?? null;
  const items = (parseDetail(lastGood?.detail).items ?? []) as LibraryItem[];

  let dismissed = new Set<string>();
  try {
    dismissed = new Set(JSON.parse(dismissedRow?.value ?? "[]"));
  } catch {
    dismissed = new Set();
  }
  const held = items.length
    ? await prisma.knowledgeSource.findMany({
        where: { provider: "tagetik", externalId: { in: items.map((i) => i.key) } },
        select: { externalId: true },
      })
    : [];
  const heldKeys = new Set(held.map((h) => h.externalId));
  const shortlist = items.filter((i) => !dismissed.has(i.key) && !heldKeys.has(i.key));

  return { shortlist, lastScan, lastGood, scanning };
}
