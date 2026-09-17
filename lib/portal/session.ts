import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The browser session the portal agent borrows.
//
// Jack signs in himself, in a real browser window. Beacon never sees, types or
// stores the password — it reuses the session cookie that login produced. That
// stays true if the portal ever adds SSO or a second factor, and there is no
// credential on disk to leak.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const PROFILE_DIR = join(root, "storage", "portal-profile");

export function hasProfile(): boolean {
  return existsSync(PROFILE_DIR);
}

// Playwright is a ~300MB install (it downloads a browser), so it is NOT a
// dependency of the app. Nobody who never touches the portal should pay for it.
// `npm run portal:setup` installs it; until then this explains itself.
export async function loadPlaywright(): Promise<any> {
  try {
    return await import("playwright");
  } catch {
    throw new Error(
      "Playwright isn't installed. It runs the browser the portal needs, and " +
        "it's a large one-off download (~300MB), so it isn't installed by " +
        "default.\n\nRun:  npm run portal:setup",
    );
  }
}

export type LaunchOptions = { headed?: boolean };

// A persistent context keeps cookies between runs — that IS the saved session.
export async function openContext({ headed = false }: LaunchOptions = {}) {
  const playwright = await loadPlaywright();
  const { mkdir } = await import("node:fs/promises");
  await mkdir(PROFILE_DIR, { recursive: true });

  return playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    viewport: { width: 1280, height: 900 },
    // No stealth flags, no spoofed fingerprint, no proxy. This identifies
    // itself as what it is: an ordinary automated Chromium.
  });
}
