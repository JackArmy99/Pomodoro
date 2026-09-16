// Run the app and the research worker together — this IS `npm run dev`.
// It starts `dev:app` (the bare Next server), never `dev`, which would recurse.
// (Zero dependencies — just two child processes sharing this terminal.)
import { spawn, execFileSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];

const isWindows = process.platform === "win32";

function start(name, script) {
  // `detached` puts the child in its own process group so we can signal the
  // WHOLE group below. Without it, `npm run x` is npm -> node and killing npm
  // leaves node orphaned — still holding the Prisma engine, which then blocks
  // `npm run update` with an EPERM nobody can trace back to here.
  const child = spawn(npm, ["run", script], {
    stdio: "inherit",
    shell: isWindows,
    detached: !isWindows,
  });
  child.on("exit", (code) => {
    console.log(`\n[${name}] exited (${code}). Stopping the other process too.`);
    stopAll();
    process.exit(code ?? 0);
  });
  children.push(child);
}

function signalTree(child, signal) {
  if (!child.pid) return;
  if (isWindows) {
    // /T takes the children of npm.cmd; /F because a polling loop won't stop
    // politely on Windows.
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      // already gone
    }
  } else {
    // Negative pid = the whole process group created by `detached`.
    try {
      process.kill(-child.pid, signal);
    } catch {
      // already gone
    }
  }
}

function stopAll() {
  for (const c of children) signalTree(c, "SIGTERM");
  // Anything still alive after a moment gets SIGKILL — a stray worker is worse
  // than an abrupt one, because it silently blocks the next update.
  setTimeout(() => {
    for (const c of children) if (c.exitCode === null) signalTree(c, "SIGKILL");
  }, 1500).unref();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopAll();
    // Give the SIGKILL escalation time to land before we go.
    setTimeout(() => process.exit(0), 2000);
  });
}

console.log("Starting Beacon (app + research worker)…\n");
start("app", "dev:app");
start("worker", "worker");
