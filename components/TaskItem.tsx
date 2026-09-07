import {
  deleteTask,
  toggleBookedInTeams,
  toggleTaskDone,
} from "@/app/actions/tasks";
import {
  formatDate,
  formatDuration,
  URGENCY_LABELS,
  URGENCY_STYLES,
} from "@/lib/format";
import ClientBadge from "@/components/ClientBadge";

type Task = {
  id: string;
  title: string;
  urgency: string;
  dueDate: Date | null;
  estimateMinutes: number | null;
  bookedInTeams: boolean;
  done: boolean;
  client: { id: string; name: string; type: string; color: string } | null;
};

export default function TaskItem({ task }: { task: Task }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
      {/* Done toggle */}
      <form action={toggleTaskDone} className="pt-0.5">
        <input type="hidden" name="id" value={task.id} />
        <button
          type="submit"
          aria-label={task.done ? "Mark not done" : "Mark done"}
          className={`grid h-5 w-5 place-items-center rounded border text-xs ${
            task.done
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-300 bg-white text-transparent hover:border-emerald-400"
          }`}
        >
          ✓
        </button>
      </form>

      <div className="min-w-0 flex-1">
        <p
          className={`text-sm ${
            task.done ? "text-slate-400 line-through" : "text-slate-900"
          }`}
        >
          {task.title}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className={`chip ${URGENCY_STYLES[task.urgency] ?? ""}`}>
            {URGENCY_LABELS[task.urgency] ?? task.urgency}
          </span>
          {task.dueDate && (
            <span className="text-xs text-slate-500">
              {formatDate(task.dueDate)}
            </span>
          )}
          {task.estimateMinutes ? (
            <span className="text-xs text-slate-400">
              ~{formatDuration(task.estimateMinutes)}
            </span>
          ) : null}
          {task.client && <ClientBadge client={task.client} />}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {/* Booked-in-Teams tick */}
        <form action={toggleBookedInTeams}>
          <input type="hidden" name="id" value={task.id} />
          <button
            type="submit"
            className={`chip ${
              task.bookedInTeams
                ? "border-violet-300 bg-violet-100 text-violet-700"
                : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50"
            }`}
            title="Toggle whether this is booked into Teams"
          >
            {task.bookedInTeams ? "✓ In Teams" : "Book in Teams"}
          </button>
        </form>
        <form action={deleteTask}>
          <input type="hidden" name="id" value={task.id} />
          <button
            type="submit"
            className="text-[11px] text-slate-400 hover:text-rose-600"
          >
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}
