// Run the app and the research worker together — this IS `npm run dev`.
// It starts `dev:app` (the bare Next server), never `dev`, which would recurse.
// (Zero dependencies — just two child processes sharing this terminal.)
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];

function start(name, script) {
  const child = spawn(npm, ["run", script], { stdio: "inherit", shell: process.platform === "win32" });
  child.on("exit", (code) => {
    console.log(`\n[${name}] exited (${code}). Stopping the other process too.`);
    stopAll();
    process.exit(code ?? 0);
  });
  children.push(child);
}

function stopAll() {
  for (const c of children) {
    if (!c.killed) c.kill();
  }
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopAll(); process.exit(0); });

console.log("Starting Beacon (app + research worker)…\n");
start("app", "dev:app");
start("worker", "worker");
