// Check that what's stored in the database matches what the schema says it is.
// Run: npm run db:check   (also runs at the end of `npm run doctor`)
//
// Why this exists: SQLite has no strict typing, and a table-rebuild migration
// generated against a *different* set of columns can silently write nonsense —
// a double-quoted identifier that matches no column is accepted as a string
// literal, so `SELECT "contentRevision"` stored the text "contentRevision" in
// an INTEGER column. Nothing complained until Prisma tried to read the table
// and every page using it went down.
//
// `npm run test:migrations` can't catch this: it migrates an EMPTY database, so
// the INSERT…SELECT copies no rows. Only real data shows the damage.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Pull every Int / Boolean / DateTime field out of the schema, so this check
// covers new models automatically instead of drifting out of date.
function scalarFieldsFromSchema() {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  const kinds = { Int: "int", Boolean: "bool", DateTime: "datetime" };
  const checks = [];

  for (const [, model, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    for (const line of body.split("\n")) {
      const m = line.trim().match(/^(\w+)\s+(\w+)(\?)?\s*(.*)$/);
      if (!m) continue;
      const [, field, type, optional, rest] = m;
      if (!kinds[type] || rest.includes("@relation")) continue;
      checks.push({
        model,
        column: field,
        kind: kinds[type],
        nullable: Boolean(optional),
      });
    }
  }
  return checks;
}

// A predicate that selects only the BROKEN rows for one column.
function brokenRowsPredicate({ column, kind, nullable }) {
  const c = `"${column}"`;
  const nullOk = nullable ? `typeof(${c}) = 'null' OR ` : "";
  switch (kind) {
    case "int":
      return `NOT (${nullOk}typeof(${c}) = 'integer')`;
    case "bool":
      return `NOT (${nullOk}(typeof(${c}) = 'integer' AND ${c} IN (0, 1)))`;
    case "datetime":
      // Prisma writes DateTime as an integer (epoch ms); CURRENT_TIMESTAMP
      // defaults in migration SQL write text. Text is fine if it parses.
      return `NOT (${nullOk}typeof(${c}) = 'integer' OR (typeof(${c}) = 'text' AND datetime(${c}) IS NOT NULL))`;
    default:
      return "0";
  }
}

export async function dbCheck({ quiet = false } = {}) {
  if (!existsSync(join(root, "prisma", "dev.db"))) {
    if (!quiet) console.log("   No database yet — run npm run setup first.");
    return { problems: [], skipped: true };
  }

  const prisma = new PrismaClient();
  const problems = [];
  try {
    const tables = new Set(
      (
        await prisma.$queryRawUnsafe(
          `SELECT name FROM sqlite_master WHERE type = 'table'`,
        )
      ).map((r) => r.name),
    );

    for (const check of scalarFieldsFromSchema()) {
      if (!tables.has(check.model)) continue; // migration not applied yet
      const where = brokenRowsPredicate(check);
      let rows;
      try {
        rows = await prisma.$queryRawUnsafe(
          `SELECT count(*) AS n FROM "${check.model}" WHERE ${where}`,
        );
      } catch {
        continue; // column not present on this database yet
      }
      const n = Number(rows?.[0]?.n ?? 0);
      if (n > 0) {
        // CAST to text on purpose: reading a corrupt value in its declared type
        // is exactly what fails, so the check must not repeat the app's mistake.
        let sample;
        try {
          const row = await prisma.$queryRawUnsafe(
            `SELECT CAST("${check.column}" AS TEXT) AS v FROM "${check.model}" WHERE ${where} LIMIT 1`,
          );
          sample = row?.[0]?.v;
        } catch {
          sample = "(unreadable)";
        }
        problems.push({ ...check, count: n, sample });
      }
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  return { problems, skipped: false };
}

function report({ problems, skipped }) {
  if (skipped) return 0;
  if (problems.length === 0) {
    console.log("✅ Database contents match the schema.");
    return 0;
  }
  console.log("❌ Some stored values don't match the schema:\n");
  for (const p of problems) {
    console.log(
      `   ${p.model}.${p.column} (${p.kind}) — ${p.count} row(s), e.g. ${JSON.stringify(p.sample)}`,
    );
  }
  console.log(
    "\n   Run  npm run update  — it applies the repair migrations.\n" +
      "   If this persists, send the lines above to Claude.",
  );
  return 1;
}

// Run directly: node scripts/db-check.mjs
if (process.argv[1] && process.argv[1].endsWith("db-check.mjs")) {
  dbCheck()
    .then((result) => process.exit(report(result)))
    .catch((err) => {
      console.error("Could not check the database:", err.message);
      process.exit(1);
    });
}

export { report };
