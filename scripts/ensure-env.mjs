// Creates a local .env from .env.example if it doesn't exist yet.
// Runs automatically before `npm run dev` and `npm run setup` so a fresh clone
// never trips over a missing DATABASE_URL.
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const examplePath = join(root, ".env.example");

if (!existsSync(envPath)) {
  if (existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log("Created .env from .env.example");
  } else {
    console.warn("No .env or .env.example found — skipping.");
  }
}
