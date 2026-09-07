import { deleteBrief } from "@/app/actions/briefs";
import { formatDate, SOURCE_LABELS } from "@/lib/format";
import ClientBadge from "@/components/ClientBadge";

type Brief = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string | null;
  sourceType: string;
  publishedAt: Date | null;
  createdAt: Date;
  clients: {
    client: { id: string; name: string; type: string; color: string };
  }[];
};

export default function BriefCard({
  brief,
  showClients = true,
}: {
  brief: Brief;
  showClients?: boolean;
}) {
  return (
    <article className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="chip border-indigo-100 bg-indigo-50 text-indigo-700">
              {SOURCE_LABELS[brief.sourceType] ?? brief.sourceType}
            </span>
            <span className="text-xs text-slate-400">
              {formatDate(brief.publishedAt ?? brief.createdAt)}
            </span>
          </div>
          <h3 className="truncate text-sm font-semibold text-slate-900">
            {brief.title}
          </h3>
        </div>
        <form action={deleteBrief}>
          <input type="hidden" name="id" value={brief.id} />
          <button
            type="submit"
            className="text-xs text-slate-400 hover:text-rose-600"
            aria-label="Delete brief"
          >
            Delete
          </button>
        </form>
      </div>

      {brief.summary && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
          {brief.summary}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {showClients &&
          brief.clients.map((bc) => (
            <ClientBadge key={bc.client.id} client={bc.client} />
          ))}
        {brief.sourceUrl && (
          <a
            href={brief.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs font-medium text-indigo-600 hover:underline"
          >
            View source ↗
          </a>
        )}
      </div>
    </article>
  );
}
