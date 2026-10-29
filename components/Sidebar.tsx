import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/db";
import { NavLinks, SettingsLink, ClientLinks } from "@/components/NavLinks";

// Home · Agents · Inbox (n) · Library · Clients, then the clients themselves
// (one click to everything about a client — Jack asked to keep this), with
// Settings pinned at the bottom.
export default async function Sidebar() {
  noStore(); // the inbox count and client list must be current
  const [inboxCount, clients] = await Promise.all([
    prisma.finding.count({ where: { status: "pending" } }),
    prisma.client.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true, color: true },
    }),
  ]);

  return (
    <aside className="glass flex h-full w-full flex-col gap-5 border-r p-4">
      <Link href="/" className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-xl bg-accent text-sm font-bold text-white shadow-soft">
          B
        </span>
        <span className="text-sm font-semibold tracking-tight">Beacon</span>
      </Link>

      <nav className="flex flex-col gap-0.5">
        <NavLinks inboxCount={inboxCount} />
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ClientLinks clients={clients.filter((c) => c.type !== "prospect")} label="Clients" />
        <ClientLinks clients={clients.filter((c) => c.type === "prospect")} label="Prospects" />
      </div>

      <nav className="flex flex-col">
        <SettingsLink />
      </nav>
    </aside>
  );
}
