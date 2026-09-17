"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-fetch a server-rendered page while something is actually happening.
//
// The pages here are server components, so `router.refresh()` re-runs the
// server render and swaps in the new HTML — no API route, no websocket, and no
// client-side copy of the data to keep in sync. It only ticks while `active` is
// true (a job queued or running), so an idle page costs nothing.
export default function AutoRefresh({
  active,
  intervalMs = 3000,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);

  return null;
}
