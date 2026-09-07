import Link from "next/link";

const links = [
  { href: "/", label: "Hub" },
  { href: "/briefs", label: "Briefs" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/clients", label: "Clients" },
];

export default function Nav() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">
            B
          </span>
          <span className="text-sm font-semibold tracking-tight">
            Beacon
            <span className="ml-1.5 font-normal text-slate-400">
              EPM Intel Hub
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
