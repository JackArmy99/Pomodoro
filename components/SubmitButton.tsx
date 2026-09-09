"use client";

import { useFormStatus } from "react-dom";

// A submit button that shows the work is happening. Research runs take 10-30
// seconds, so without this the page just sits there and invites a second click.
export default function SubmitButton({
  children,
  pendingLabel = "Working…",
  className = "btn",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
    >
      {pending ? (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
          />
          {pendingLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
