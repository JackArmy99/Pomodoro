import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// Turn Chromium's OWN password manager off before it ever launches.
//
// Beacon never handles a password, but the profile is a real Chromium profile:
// if the browser's "Save password?" prompt appeared and was accepted, Chromium
// would store it here in its own encrypted store. Disabling the prompt means
// the question can't arise, rather than relying on nobody having clicked it.
function writeNoPasswordManagerPrefs() {
  const defaultDir = join(PROFILE_DIR, "Default");
  mkdirSync(defaultDir, { recursive: true });
  const prefsPath = join(defaultDir, "Preferences");

  let prefs: Record<string, any> = {};
  try {
    prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
  } catch {
    prefs = {}; // no profile yet, or unreadable — start clean
  }

  prefs.credentials_enable_service = false;
  prefs.credentials_enable_autosignin = false;
  prefs.profile = { ...(prefs.profile ?? {}), password_manager_enabled: false };

  try {
    writeFileSync(prefsPath, JSON.stringify(prefs));
  } catch {
    // Not fatal: the browser still works, the prompt may just appear.
  }
}

// What the saved profile actually holds — so "is my password in there?" is
// answered with evidence rather than assurance.
export type ProfileContents = {
  savedPasswords: number | null; // null = couldn't read the store
  loginDataExists: boolean;
};

export function inspectProfile(): ProfileContents {
  const loginData = join(PROFILE_DIR, "Default", "Login Data");
  if (!existsSync(loginData)) {
    return { savedPasswords: 0, loginDataExists: false };
  }
  try {
    // Chromium's password store is a SQLite file; count rows without decrypting
    // anything. A count is all that's needed to answer the question.
    const out = execFileSync(
      process.execPath,
      [
        "--no-warnings", // node:sqlite is experimental and says so loudly
        "-e",
        `const {DatabaseSync}=require("node:sqlite");` +
          `const db=new DatabaseSync(process.argv[1],{readOnly:true});` +
          `console.log(db.prepare("select count(*) c from logins").get().c);`,
        loginData,
      ],
      { encoding: "utf8" },
    );
    return { savedPasswords: Number(out.trim()), loginDataExists: true };
  } catch {
    return { savedPasswords: null, loginDataExists: true };
  }
}

export type LaunchOptions = { headed?: boolean };

// A persistent context keeps cookies between runs — that IS the saved session.
export async function openContext({ headed = false }: LaunchOptions = {}) {
  const playwright = await loadPlaywright();
  mkdirSync(PROFILE_DIR, { recursive: true });
  writeNoPasswordManagerPrefs();

  return playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    viewport: { width: 1280, height: 900 },
    // No stealth flags, no spoofed fingerprint, no proxy. This identifies
    // itself as what it is: an ordinary automated Chromium.
  });
}
