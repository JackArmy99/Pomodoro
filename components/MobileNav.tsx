import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { prisma } from "@/lib/db";
import { NavLinks } from "@/components/NavLinks";

// Shown only on small screens, where the left sidebar is hidden. Same
// sections as the sidebar, Settings included.
export default async function MobileNav() {
  noStore();
  const inboxCount = await prisma.finding.count({ where: { status: "pending" } });
  return (
    <header className="glass sticky top-0 z-20 flex items-center gap-1 overflow-x-auto border-b px-3 py-2.5 md:hidden">
      <Link href="/" className="mr-2 flex shrink-0 items-center gap-1.5">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-accent text-xs font-bold text-white shadow-soft">
          B
        </span>
      </Link>
      <nav className="flex items-center gap-1">
        <NavLinks inboxCount={inboxCount} compact />
      </nav>
    </header>
  );
}
