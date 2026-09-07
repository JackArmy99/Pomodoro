import Link from "next/link";

type Props = {
  client: { id: string; name: string; type: string; color: string };
  href?: boolean;
};

export default function ClientBadge({ client, href = true }: Props) {
  const inner = (
    <span className="chip border-slate-200 bg-slate-50 text-slate-700">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: client.color }}
      />
      {client.name}
      {client.type === "prospect" && (
        <span className="text-[10px] uppercase tracking-wide text-amber-600">
          prospect
        </span>
      )}
    </span>
  );

  if (!href) return inner;
  return (
    <Link href={`/clients/${client.id}`} className="hover:opacity-80">
      {inner}
    </Link>
  );
}
