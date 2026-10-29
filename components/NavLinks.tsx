"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MAIN_NAV, SETTINGS_NAV, isActive } from "@/lib/nav";

const base =
  "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition duration-200 ease-apple";
const on = "bg-indigo-50 font-medium text-indigo-700";
const off = "text-slate-700 hover:bg-slate-200/60 hover:text-ink";

export function NavLinks({ inboxCount, compact = false }: { inboxCount: number; compact?: boolean }) {
  const path = usePathname() ?? "/";
  return (
    <>
      {MAIN_NAV.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`${compact ? "rounded-lg px-2.5 py-1 text-sm" : base} ${isActive(path, l.href) ? on : off}`}
        >
          <span>{l.label}</span>
          {l.badge === "inbox" && inboxCount > 0 && (
            <span className="ml-1.5 rounded-full bg-indigo-600 px-1.5 text-[11px] font-semibold text-white">
              {inboxCount}
            </span>
          )}
        </Link>
      ))}
      {compact && (
        <Link
          href={SETTINGS_NAV.href}
          className={`rounded-lg px-2.5 py-1 text-sm ${isActive(path, SETTINGS_NAV.href) ? on : off}`}
        >
          {SETTINGS_NAV.label}
        </Link>
      )}
    </>
  );
}

// The client list under the sections; the open client is highlighted.
export function ClientLinks({
  clients,
  label,
}: {
  clients: { id: string; name: string; color: string }[];
  label: string;
}) {
  const path = usePathname() ?? "/";
  if (clients.length === 0) return null;
  return (
    <div className="mb-3">
      <h3 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</h3>
      <ul className="flex flex-col gap-0.5">
        {clients.map((c) => {
          const active = path === `/clients/${c.id}`;
          return (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition duration-200 ease-apple ${
                  active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-700 hover:bg-slate-200/60 hover:text-ink"
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="truncate">{c.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SettingsLink() {
  const path = usePathname() ?? "/";
  return (
    <Link href={SETTINGS_NAV.href} className={`${base} ${isActive(path, SETTINGS_NAV.href) ? on : off}`}>
      {SETTINGS_NAV.label}
    </Link>
  );
}
