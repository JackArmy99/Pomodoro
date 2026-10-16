// Diagnose the AI/research path end to end, so failures give a precise reason
// instead of a silent "Nothing new". Run: npm run doctor
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env into process.env (plain node doesn't do this for us).
function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return false;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Handle KEY="value"  # trailing comment  — take what's inside the quotes
    // and discard the rest, matching how Next.js reads .env.
    const quoted = value.match(/^(['"])(.*?)\1/);
    if (quoted) {
      value = quoted[2];
    } else {
      value = value.split(/\s+#/)[0].trim(); // unquoted: strip " # comment"
    }
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

// The commonest mistake: the key is in .env but still behind the `#` that
// shipped in the template, so nothing reads it.
function isCommentedOut(name) {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return false;
  return readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .some((l) => new RegExp(`^\\s*#\\s*${name}\\s*=\\s*\\S`).test(l));
}

const ok = (m) => console.log(`✅ ${m}`);
const bad = (m) => console.log(`❌ ${m}`);
const info = (m) => console.log(`   ${m}`);

function explain(err) {
  const status = err?.status;
  const msg = err?.message || String(err);
  info(msg.slice(0, 300));
  if (status === 401)
    info("→ The API key is invalid. Copy it again from console.anthropic.com.");
  else if (status === 400 && /credit|balance/i.test(msg))
    info("→ Your API account has no credit. Add credit in the console (Billing).");
  else if (status === 429)
    info("→ Rate limited. Wait a moment and try again.");
  else if (status === 400)
    info("→ The request was rejected — see the message above.");
}

// Read the reply by block type, never by position: current models can open
// with a thinking block, so content[0] is not necessarily the answer.
function textOf(r) {
  return r.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// Rough price, per million tokens, mirroring lib/research/cost.ts. Only for the
// "this check cost about Xp" line — the app's own costs come from cost.ts.
function approxMicroUsd(model, usage) {
  const inTok = usage?.input_tokens ?? 0;
  const outTok = usage?.output_tokens ?? 0;
  let rate = [2, 10]; // sonnet
  if (model.includes("haiku-5")) rate = inTok > 100_000 ? [0.5, 2.5] : [0.1, 0.5];
  else if (model.includes("haiku")) rate = [1, 5];
  else if (model.includes("opus")) rate = [5, 25];
  return Math.round(inTok * rate[0] + outTok * rate[1]);
}

async function main() {
  console.log("\n🩺 Beacon doctor — checking the research path\n");

  // 1. .env + key
  const hadEnv = loadEnv();
  hadEnv ? ok(".env file found") : bad(".env file missing (run `npm run dev` once to create it)");

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    if (isCommentedOut("ANTHROPIC_API_KEY")) {
      bad("ANTHROPIC_API_KEY is in .env but the line is COMMENTED OUT.");
      info("Delete the leading `# ` so the line starts with ANTHROPIC_API_KEY=");
      info('It should read:  ANTHROPIC_API_KEY="sk-ant-..."');
    } else {
      bad("ANTHROPIC_API_KEY is not set.");
      info('On your laptop: add a line to .env:  ANTHROPIC_API_KEY="sk-ant-..."');
    }
    // A cloud session reads the key from its environment, not from .env.
    info("In a cloud session: add it as an environment variable in the environment");
    info("settings, then start a NEW session — a running one won't see it.");
    process.exit(1);
  }
  ok(`ANTHROPIC_API_KEY found (${key.slice(0, 8)}…${key.slice(-4)})`);

  // Both models the app uses, each checked with the request shapes it really
  // sends. Test mode used to be checked by nothing at all — which is how it
  // could sit broken: Haiku 4.5 rejects `effort`, and summariseItem sends it.
  //
  // These defaults MUST match lib/anthropic.ts (this is a .mjs file, so it
  // can't import that .ts module — see CLAUDE.md). `npm run test:portal`
  // compares the two so they can't drift apart.
  const FULL_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const TEST_MODEL = process.env.ANTHROPIC_TEST_MODEL || "claude-haiku-5-5";
  const models = [{ label: "Full quality", model: FULL_MODEL }];
  if (TEST_MODEL !== FULL_MODEL) models.push({ label: "Test mode", model: TEST_MODEL });

  const client = new Anthropic({ apiKey: key });
  const results = [];
  let spent = 0; // micro-USD, approximate — for "what did this check cost"

  for (const { label, model } of models) {
    console.log(`\n— ${label}: ${model} —`);
    const row = { label, model, basic: false, effort: false, schema: false, search: null };

    // 1. A plain call: the key, the credit and the model name.
    // max_tokens leaves room for thinking, which current models do by default
    // and which counts toward the cap — a tiny cap can return no text at all.
    try {
      const r = await client.messages.create({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: "Reply with just: OK" }],
      });
      spent += approxMicroUsd(model, r.usage);
      const text = textOf(r);
      if (text) {
        ok(`Basic call: "${text.slice(0, 40)}"`);
        row.basic = true;
      } else {
        bad(`Basic call returned no text (stop_reason ${r.stop_reason}).`);
      }
    } catch (err) {
      bad("Basic call failed — nothing on this model can work until this passes.");
      explain(err);
      results.push(row);
      continue;
    }

    // 2. What summariseItem sends: a low effort level. Inbox triage and page
    //    assessment both go through it.
    try {
      const r = await client.messages.create({
        model,
        max_tokens: 1024,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: "Reply with just: OK" }],
      });
      spent += approxMicroUsd(model, r.usage);
      ok("Effort setting accepted (inbox triage and page assessment will work)");
      row.effort = true;
    } catch (err) {
      bad("Effort setting rejected — inbox triage and page assessment will fail on this model.");
      explain(err);
    }

    // 3. What the video summariser sends: a reply constrained to a JSON Schema.
    try {
      const r = await client.messages.create({
        model,
        max_tokens: 1024,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false,
            },
          },
        },
        messages: [{ role: "user", content: 'Return {"ok": true}.' }],
      });
      spent += approxMicroUsd(model, r.usage);
      const parsed = JSON.parse(textOf(r) || "null");
      if (parsed?.ok === true) {
        ok("Structured JSON replies work (video summaries will parse)");
        row.schema = true;
      } else {
        bad(`Structured reply came back in an unexpected shape: ${textOf(r).slice(0, 80)}`);
      }
    } catch (err) {
      bad("Structured JSON replies failed — video summaries fall back to unconstrained JSON on this model.");
      explain(err);
    }

    // 4. Web search — the tool the Finder depends on. Report which tool type
    //    this model accepts: the newer one is documented for Opus and Sonnet,
    //    and the app now remembers the answer per model.
    for (const type of ["web_search_20260209", "web_search_20250305"]) {
      try {
        const r = await client.messages.create({
          model,
          max_tokens: 1024,
          tools: [{ type, name: "web_search", max_uses: 1 }],
          messages: [
            {
              role: "user",
              content:
                "Use web search to find one recent news item about CCH Tagetik. Reply in one sentence.",
            },
          ],
        });
        spent += approxMicroUsd(model, r.usage) + 10_000; // ~$0.01 per search
        const searched = r.content.some((b) => b.type === "web_search_tool_result");
        ok(`Web search works with "${type}"${searched ? "" : " (no search was needed)"}`);
        info(`Sample: ${textOf(r).slice(0, 140)}`);
        row.search = type;
        break;
      } catch (err) {
        info(`"${type}" not accepted on this model — trying the next.`);
        if (type === "web_search_20250305") {
          bad("Web search is not available on this model — the Finder can't research with it.");
          explain(err);
        }
      }
    }

    results.push(row);
  }

  // One line per model, so the verdict doesn't need reading the whole log.
  console.log("\n— Summary —");
  let failed = false;
  for (const r of results) {
    const parts = [
      r.basic ? "call ✓" : "call ✗",
      r.effort ? "effort ✓" : "effort ✗",
      r.schema ? "JSON ✓" : "JSON ✗",
      r.search ? `search ✓ (${r.search})` : "search ✗",
    ];
    const allGood = r.basic && r.effort && r.schema && r.search;
    if (!allGood) failed = true;
    console.log(`${allGood ? "✅" : "❌"} ${r.label.padEnd(12)} ${r.model.padEnd(18)} ${parts.join(" · ")}`);
  }
  info(`This check cost roughly ${(spent / 1_000_000 * 0.79 * 100).toFixed(1)}p.`);
  if (failed) {
    console.log("");
    bad("Some checks failed — see above. The model named on a ❌ line is the one to fix.");
    process.exit(1);
  }

  console.log("\n— Test 3: database contents —");
  const { dbCheck, report } = await import("./db-check.mjs");
  if (report(await dbCheck({ quiet: true })) !== 0) {
    bad("\nThe database has values the app can't read — pages using them will fail.");
    process.exit(1);
  }

  console.log("\n🎉 All checks passed — agents should research successfully.\n");
}

main().catch((err) => {
  bad("Doctor hit an unexpected problem:");
  explain(err);
  process.exit(1);
});
