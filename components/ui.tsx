import Link from "next/link";

// Shared building blocks, so every screen looks and behaves the same.
// Writing rule (docs/ui-tie-together.md): no explanatory paragraphs — a clear
// title, one primary action, and one short line only when a screen is empty.

export function PageHeader({
  title,
  action,
  back,
  chips,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  back?: { href: string; label: string };
  chips?: React.ReactNode;
}) {
  return (
    <header className="space-y-1">
      {back && (
        <Link href={back.href} className="text-xs text-indigo-600 hover:underline">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {chips && <div className="flex flex-wrap items-center gap-2">{chips}</div>}
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}

export type TabDef = { key: string; label: string; count?: number };

// Link tabs: the active tab is in the address (?tab=…), so it survives a
// reload and every tab can be linked to directly.
export function Tabs({ tabs, active, base }: { tabs: TabDef[]; active: string; base: string }) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => {
        const on = t.key === active;
        const sep = base.includes("?") ? "&" : "?";
        return (
          <Link
            key={t.key}
            href={`${base}${sep}tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              on
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

const TONES = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-indigo-200 bg-indigo-50 text-indigo-700",
  grey: "border-slate-200 bg-slate-50 text-slate-600",
} as const;
export type Tone = keyof typeof TONES;

export function StatusChip({ tone = "grey", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`chip ${TONES[tone]}`}>{children}</span>;
}

// One line and, at most, one button.
export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <span>{children}</span>
      {action}
    </div>
  );
}

export function SidePanel({ children }: { children: React.ReactNode }) {
  return <aside className="space-y-3 lg:sticky lg:top-6">{children}</aside>;
}

export function PanelBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-2 p-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <div className="text-sm">{children}</div>
    </section>
  );
}

// Closed by default; for everything that isn't needed on first open.
export function Advanced({
  label = "Advanced",
  open = false,
  children,
}: {
  label?: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={open} className="card group">
      <summary className="cursor-pointer select-none list-none text-sm font-medium text-slate-600 [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition group-open:rotate-90">▸</span> {label}
      </summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
