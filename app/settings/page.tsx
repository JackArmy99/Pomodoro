import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { isTestMode, hasApiKey } from "@/lib/anthropic";
import { portalEnabled } from "@/lib/portal/enabled";
import { setTestMode } from "@/app/actions/agents";
import { togglePortal } from "@/app/actions/knowledge";
import { setProductContext, setModuleDescription, createModule } from "@/app/actions/modules";
import { createCategory, deleteCategory } from "@/app/actions/categories";
import SubmitButton from "@/components/SubmitButton";
import { PageHeader, Section, StatusChip } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// The portal sign-in Beacon keeps (never a password). Read from disk here
// rather than through lib/portal/session.ts, which loads the browser add-on.
function portalSession(): { saved: boolean; at: Date | null } {
  const dir = process.env.PORTAL_PROFILE_DIR || join(process.cwd(), "storage", "portal-profile");
  const file = join(dir, "beacon-session.json");
  if (!existsSync(file)) return { saved: false, at: null };
  try {
    return { saved: true, at: statSync(file).mtime };
  } catch {
    return { saved: true, at: null };
  }
}

function Toggle({ on, action, label }: { on: boolean; action: (f: FormData) => Promise<void>; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="on" value={on ? "false" : "true"} />
      <button
        type="submit"
        className={`chip ${on ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-slate-300"}`} />
        {label}: {on ? "on" : "off"}
      </button>
    </form>
  );
}

export default async function SettingsPage() {
  const [testMode, portalOn, productContext, modules, categories] = await Promise.all([
    isTestMode(),
    portalEnabled(),
    prisma.setting.findUnique({ where: { key: "product_context" } }),
    prisma.module.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { clients: true } } },
    }),
    prisma.opportunityCategory.findMany({ orderBy: { name: "asc" } }),
  ]);
  const session = portalSession();

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" />

      <Section title="Research">
        <div className="card flex flex-wrap items-center justify-between gap-3">
          <Toggle on={testMode} action={setTestMode} label="Test mode" />
          <span className="text-sm text-slate-600">
            {testMode ? "Haiku · 2 searches · about 2p a run" : "Sonnet · up to 5 searches · about 10–15p a run"}
          </span>
          {!hasApiKey() && <StatusChip tone="red">No API key — AI is off</StatusChip>}
        </div>
      </Section>

      <Section title="Tagetik Community">
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Toggle on={portalOn} action={togglePortal} label="Community access" />
            {session.saved ? (
              <StatusChip tone="green">
                Signed in{session.at ? ` · saved ${formatDate(session.at)}` : ""}
              </StatusChip>
            ) : (
              <StatusChip tone="amber">Not signed in — run npm run portal:login</StatusChip>
            )}
          </div>
          {/* The recorded confirmation: switching on IS Jack's statement that
              automated access is permitted. Kept word for word. */}
          <p className="text-xs text-slate-500">
            Switching this on confirms that automated access is permitted under your agreement with
            Wolters Kluwer. Nothing is fetched until it is on.
          </p>
        </div>
      </Section>

      <Section title="What Beacon should know about our firm">
        <form action={setProductContext} className="card space-y-2">
          <textarea name="value" rows={6} defaultValue={productContext?.value ?? ""} className="field" />
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </div>
        </form>
      </Section>

      <Section title={`Modules (${modules.length})`}>
        <ul className="card divide-y divide-slate-100 p-0">
          {modules.map((m) => (
            <li key={m.id}>
              <details className="group px-4 py-2">
                <summary className="flex cursor-pointer items-center gap-3 text-sm">
                  <span className="font-medium text-slate-900">{m.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
                    {m.description || "No description"}
                  </span>
                  <Link href={`/modules/${m.id}`} className="text-xs text-slate-500 hover:underline">
                    {m._count.clients} client{m._count.clients === 1 ? "" : "s"}
                  </Link>
                </summary>
                <form action={setModuleDescription} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={m.id} />
                  <textarea name="description" rows={3} defaultValue={m.description ?? ""} className="field" />
                  <div className="flex justify-end">
                    <SubmitButton className="btn-ghost py-1.5" pendingLabel="Saving…">
                      Save
                    </SubmitButton>
                  </div>
                </form>
              </details>
            </li>
          ))}
        </ul>
        <form action={createModule} className="flex items-end gap-2">
          <input name="name" placeholder="New module name" className="field" required />
          <SubmitButton className="btn-ghost whitespace-nowrap" pendingLabel="Adding…">
            Add module
          </SubmitButton>
        </form>
      </Section>

      <Section title="Opportunity categories">
        <div className="card space-y-3">
          {categories.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm text-violet-800"
                >
                  {c.name}
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className="text-violet-400 hover:text-rose-600" aria-label={`Remove ${c.name}`}>
                      ✕
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={createCategory} className="flex items-end gap-2">
            <input name="name" placeholder="New category" className="field" required />
            <SubmitButton className="btn-ghost whitespace-nowrap" pendingLabel="Adding…">
              Add category
            </SubmitButton>
          </form>
        </div>
      </Section>
    </div>
  );
}
