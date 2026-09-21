// Which hosts the portal agent is allowed to touch. Nothing else, ever.
//
// This is a hard boundary enforced in code, not an instruction in a prompt: a
// page can contain any link at all, and "please stay on this site" is not a
// control. Every navigation is checked here first.
//
// The list can only be widened through the environment (`PORTAL_ALLOWED_HOSTS`
// in .env), which Jack controls directly. Deliberately NOT editable from inside
// the app, so nothing the agent reads can ever extend its own reach.

const DEFAULT_HOSTS = [
  "tagetik.com",
  "wolterskluwer.com",
  "wolterskluwer.co.uk",
];

export function allowedHosts(): string[] {
  const extra = (process.env.PORTAL_ALLOWED_HOSTS ?? "")
    .split(/[,\s]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...DEFAULT_HOSTS, ...extra])];
}

export type UrlCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

export function checkUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That isn't a valid web address." };
  }

  // https only: a portal session must never be sent over plain http, and
  // file:/data: would be a way to read the local machine.
  if (url.protocol !== "https:") {
    return { ok: false, reason: `Only https is allowed, not ${url.protocol}` };
  }

  // Credentials in the URL would end up in logs.
  if (url.username || url.password) {
    return { ok: false, reason: "Web addresses with credentials in them are refused." };
  }

  const host = url.hostname.toLowerCase();
  const permitted = allowedHosts().some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
  if (!permitted) {
    return {
      ok: false,
      reason: `${host} is not on the allowed list (${allowedHosts().join(", ")}).`,
    };
  }

  return { ok: true, url };
}

// Links found on a fetched page, reduced to the ones we would be permitted to
// follow. Used by the dry run to show intent before anything is retrieved.
export function permittedLinks(links: string[], base: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const href of links) {
    let absolute: string;
    try {
      absolute = new URL(href, base).toString();
    } catch {
      continue;
    }
    const check = checkUrl(absolute);
    if (!check.ok) continue;
    // Drop the fragment: three links to the same page are one page.
    check.url.hash = "";
    const key = check.url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

// The mirror image of `permittedLinks`: what a page pointed at that we are NOT
// allowed to follow, grouped by host.
//
// This is how the preview answers "where does the video actually live?" — on a
// webinar page the player is routinely on someone else's host, and silently
// dropping those links meant the one fact we needed never appeared. Reporting a
// host is not visiting it: `checkUrl` still governs every navigation and the
// allowlist is unchanged.
export type NotFollowed = { host: string; count: number; example: string; reason: string };

export function rejectedLinks(links: string[], base: string): NotFollowed[] {
  const byHost = new Map<string, NotFollowed>();
  for (const href of links) {
    let absolute: URL;
    try {
      absolute = new URL(href, base);
    } catch {
      continue;
    }
    // Only web addresses are interesting here; mailto:, tel: and javascript:
    // are page furniture, not somewhere content could be hiding.
    if (absolute.protocol !== "https:" && absolute.protocol !== "http:") continue;
    if (checkUrl(absolute.toString()).ok) continue;

    const host = absolute.hostname.toLowerCase();
    const seen = byHost.get(host);
    if (seen) {
      seen.count++;
    } else {
      byHost.set(host, {
        host,
        count: 1,
        example: absolute.toString().slice(0, 300),
        reason:
          absolute.protocol === "https:"
            ? "not on the allowed list"
            : `${absolute.protocol} — https only`,
      });
    }
  }
  return [...byHost.values()].sort((a, b) => b.count - a.count);
}
