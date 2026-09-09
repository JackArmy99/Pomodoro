import Link from "next/link";

const links = [
  { href: "/", label: "Hub" },
  { href: "/agents", label: "Agents" },
  { href: "/research", label: "Inbox" },
  { href: "/clients", label: "Clients" },
];

// Shown only on small screens, where the left sidebar is hidden.
export default function MobileNav() {
  return (
    <header className="glass sticky top-0 z-20 flex items-center gap-1 border-b px-3 py-2.5 md:hidden">
      <Link href="/" className="mr-2 flex items-center gap-1.5">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-accent text-xs font-bold text-white shadow-soft">
          B
        </span>
        <span className="text-sm font-semibold">Beacon</span>
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-lg px-2.5 py-1 text-slate-600 transition duration-200 ease-apple hover:bg-slate-200/60 hover:text-ink"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
