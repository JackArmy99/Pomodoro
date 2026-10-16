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

// PORTAL_PROFILE_DIR exists for the test gate, which must NEVER touch the real
// profile: it used to borrow this exact folder and delete it at the end — fine
// in a cloud container, but on Jack's laptop that is his saved sign-in.
export const PROFILE_DIR =
  process.env.PORTAL_PROFILE_DIR || join(root, "storage", "portal-profile");

export function hasProfile(): boolean {
  return existsSync(PROFILE_DIR);
}

export { looksLikeLoginUrl } from "./loginPage";

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

// The Community login only lasts while the browser stays open: its session
// cookie has no expiry date, and Chromium discards such cookies when the
// browser closes — even in a persistent profile. Proven on Jack's laptop: a
// sign-in that worked was gone the moment the window reopened. So Beacon keeps
// the session itself, in a file inside the profile folder:
//   - never the password — only what the site handed out after Jack signed in;
//   - inside PROFILE_DIR, so `portal:forget` deletes it with everything else,
//     and the git-ignored storage/ folder keeps it off GitHub;
//   - restored only into this browser, which the allowlist still confines.
// It lasts as long as the SITE keeps the session alive; when that ends, the
// pipeline reports "signed out" and Jack runs portal:login again.
export const SESSION_FILE = join(PROFILE_DIR, "beacon-session.json");

type SavedSession = {
  savedAt: string;
  cookies: any[];
  // localStorage and sessionStorage, per origin. sessionStorage is captured
  // because some sites keep the login token there, and Playwright's own
  // storageState() leaves it out.
  local: { origin: string; items: { name: string; value: string }[] }[];
  session: { origin: string; items: { name: string; value: string }[] }[];
};

// Called by portal:login right after Jack signs in, while the window is open.
export async function saveSession(context: any, page: any): Promise<{
  sessionOnlyCookies: string[];
  localKeys: string[];
  sessionKeys: string[];
}> {
  const state = await context.storageState();
  const sessionItems = await page
    .evaluate(() =>
      Object.keys(sessionStorage).map((name) => ({
        name,
        value: sessionStorage.getItem(name) ?? "",
      })),
    )
    .catch(() => []);
  const origin = new URL(page.url()).origin;

  const saved: SavedSession = {
    savedAt: new Date().toISOString(),
    cookies: state.cookies ?? [],
    local: (state.origins ?? []).map((o: any) => ({
      origin: o.origin,
      items: o.localStorage ?? [],
    })),
    session: sessionItems.length ? [{ origin, items: sessionItems }] : [],
  };
  writeFileSync(SESSION_FILE, JSON.stringify(saved));

  // Names only, for the diagnosis — never values.
  return {
    sessionOnlyCookies: saved.cookies
      .filter((c) => c.expires === -1)
      .map((c) => `${c.domain} ${c.name}`),
    localKeys: saved.local.flatMap((o) => o.items.map((i) => `${o.origin} ${i.name}`)),
    sessionKeys: saved.session.flatMap((o) => o.items.map((i) => `${o.origin} ${i.name}`)),
  };
}

async function restoreSession(context: any): Promise<void> {
  if (!existsSync(SESSION_FILE)) return;
  let saved: SavedSession;
  try {
    saved = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
  } catch {
    return; // unreadable — behave as signed out, portal:login fixes it
  }
  if (saved.cookies?.length) await context.addCookies(saved.cookies);
  for (const kind of ["local", "session"] as const) {
    for (const entry of saved[kind] ?? []) {
      await context.addInitScript(
        ({ origin, items, kind }: any) => {
          if (location.origin !== origin) return;
          const store = kind === "local" ? localStorage : sessionStorage;
          for (const { name, value } of items) {
            if (store.getItem(name) === null) store.setItem(name, value);
          }
        },
        { origin: entry.origin, items: entry.items, kind },
      );
    }
  }
}

// A persistent context keeps long-lived cookies between runs; restoreSession
// adds back the session-only login the site uses.
export async function openContext({ headed = false }: LaunchOptions = {}) {
  const playwright = await loadPlaywright();
  mkdirSync(PROFILE_DIR, { recursive: true });
  writeNoPasswordManagerPrefs();

  const context = await playwright.chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    viewport: { width: 1280, height: 900 },
    // No stealth flags, no spoofed fingerprint, no proxy. This identifies
    // itself as what it is: an ordinary automated Chromium.
  });
  await restoreSession(context);
  return context;
}
