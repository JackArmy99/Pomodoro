// Stop anything Beacon left running. Run: npm run stop
//
// This exists because the research worker can outlive the window that started
// it, and while it runs it holds the Prisma query engine open — which blocks
// `npm run update` on Windows with an EPERM that names a file, not a cause.
// Rather than hunting through Task Manager, stop it by name.
import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const isWindows = process.platform === "win32";

// Match on the script path, so we only ever kill this project's processes and
// never somebody's unrelated Node app.
// "next-server" matters: Next renames its dev-server process, so matching only
// "next dev" leaves the real server orphaned.
const PATTERNS = [
  "research-worker",
  "dev-all.mjs",
  "next dev",
  "next-server",
];

function stopWindows() {
  let stopped = 0;
  for (const pattern of PATTERNS) {
    // Find node processes whose command line mentions the pattern, then kill
    // each process tree (/T) — npm.cmd wrappers hide the real worker below them.
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
      `Where-Object { $_.CommandLine -like '*${pattern}*' } | ` +
      `ForEach-Object { $_.ProcessId }`;
    let out = "";
    try {
      out = execFileSync("powershell", ["-NoProfile", "-Command", script], {
        encoding: "utf8",
      });
    } catch {
      continue;
    }
    for (const pid of out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      if (Number(pid) === process.pid) continue;
      try {
        execFileSync("taskkill", ["/pid", pid, "/T", "/F"], { stdio: "ignore" });
        stopped++;
      } catch {
        // already gone
      }
    }
  }
  return stopped;
}

// Deliberately NOT `pkill -f <pattern>`: that matches any process whose command
// line merely mentions the pattern — including the shell that typed it, which is
// exactly what happened the first time. Enumerate, then filter precisely.
function stopPosix() {
  let out = "";
  try {
    out = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  } catch {
    return 0;
  }

  // Every ancestor, not just the parent: the shell that ran `npm run stop` sits
  // in this directory and its command line can easily mention one of the
  // patterns — which is how an early version killed the terminal it was typed
  // into. Walk the chain and spare all of it.
  const mine = new Set([process.pid]);
  let walk = process.ppid;
  for (let depth = 0; walk > 1 && depth < 10; depth++) {
    mine.add(walk);
    try {
      const stat = readFileSync(`/proc/${walk}/stat`, "utf8");
      walk = Number(stat.split(") ").pop().split(" ")[1]);
    } catch {
      break;
    }
  }

  let stopped = 0;

  for (const line of out.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = match[2];

    if (mine.has(pid)) continue;
    if (args.includes("stop.mjs")) continue; // never ourselves
    if (!PATTERNS.some((p) => args.includes(p))) continue;

    // Only this project's processes: the working directory must be the repo.
    try {
      if (readlinkSync(`/proc/${pid}/cwd`) !== root) continue;
    } catch {
      continue; // can't prove it's ours, so leave it alone
    }

    try {
      process.kill(pid, "SIGKILL");
      stopped++;
    } catch {
      // already gone
    }
  }
  return stopped;
}

const stopped = isWindows ? stopWindows() : stopPosix();
console.log(
  stopped > 0
    ? "Stopped Beacon's background processes. You can run npm run update now."
    : "Nothing of Beacon's was running.",
);
