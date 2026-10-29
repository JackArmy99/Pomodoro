// The app's sections, in the order the work happens:
// Agents gather → Inbox you review → Library what we know → Clients who it
// affects. Briefs, Opportunities and Modules are off the menu but still work
// (their records now show on each client). Asserted in `npm run test:docs`.

export const MAIN_NAV = [
  { href: "/", label: "Home" },
  { href: "/agents", label: "Agents" },
  { href: "/research", label: "Inbox", badge: "inbox" as const },
  { href: "/library", label: "Library" },
  { href: "/clients", label: "Clients" },
];

export const SETTINGS_NAV = { href: "/settings", label: "Settings" };

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
