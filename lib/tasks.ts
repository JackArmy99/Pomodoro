// Group tasks into day / week / month buckets by due date, so the Hub can show
// "what's on for my day, week and month" at a glance.

export type Bucketed<T> = { key: string; label: string; tasks: T[] };

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function bucketTasks<T extends { dueDate: Date | null }>(
  tasks: T[],
  now: Date = new Date(),
): Bucketed<T>[] {
  const startToday = startOfDay(now);
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startInAWeek = new Date(startToday);
  startInAWeek.setDate(startInAWeek.getDate() + 7);
  const startNextMonth = new Date(
    startToday.getFullYear(),
    startToday.getMonth() + 1,
    1,
  );

  const buckets: Record<string, T[]> = {
    overdue: [],
    today: [],
    week: [],
    month: [],
    later: [],
    someday: [],
  };

  for (const t of tasks) {
    if (!t.dueDate) {
      buckets.someday.push(t);
      continue;
    }
    const due = new Date(t.dueDate);
    if (due < startToday) buckets.overdue.push(t);
    else if (due < startTomorrow) buckets.today.push(t);
    else if (due < startInAWeek) buckets.week.push(t);
    else if (due < startNextMonth) buckets.month.push(t);
    else buckets.later.push(t);
  }

  const order: { key: string; label: string }[] = [
    { key: "overdue", label: "Overdue" },
    { key: "today", label: "Today" },
    { key: "week", label: "This week" },
    { key: "month", label: "This month" },
    { key: "later", label: "Later" },
    { key: "someday", label: "No date" },
  ];

  return order
    .map(({ key, label }) => ({ key, label, tasks: buckets[key] }))
    .filter((b) => b.tasks.length > 0);
}
