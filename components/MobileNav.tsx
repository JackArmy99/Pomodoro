import Link from "next/link";

const links = [
  { href: "/", label: "Hub" },
  { href: "/briefs", label: "Briefs" },
  { href: "/opportunities", label: "Opps" },
  { href: "/clients", label: "Clients" },
];

// Shown only on small screens, where the left sidebar is hidden.
export default function MobileNav() {
  return (
    <header className="flex items-center gap-1 border-b border-slate-200 bg-white px-3 py-2 md:hidden">
      <Link href="/" className="mr-2 flex items-center gap-1.5">
        <span className="grid h-6 w-6 place-items-center rounded bg-indigo-600 text-xs font-bold text-white">
          B
        </span>
        <span className="text-sm font-semibold">Beacon</span>
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
