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
      bad("ANTHROPIC_API_KEY is not set in .env");
      info('Add a line:  ANTHROPIC_API_KEY="sk-ant-..."   then re-run this.');
    }
    process.exit(1);
  }
  ok(`ANTHROPIC_API_KEY found (${key.slice(0, 8)}…${key.slice(-4)})`);

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  ok(`Model: ${model}`);

  const client = new Anthropic({ apiKey: key });

  // 2. Basic call — proves key, credit and model.
  console.log("\n— Test 1: basic Claude call —");
  try {
    const r = await client.messages.create({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with just: OK" }],
    });
    const text = r.content.find((b) => b.type === "text")?.text?.trim();
    ok(`Claude replied: "${text}"`);
    info(`tokens in/out: ${r.usage?.input_tokens}/${r.usage?.output_tokens}`);
  } catch (err) {
    bad("Basic Claude call failed — the agents cannot work until this passes.");
    explain(err);
    process.exit(1);
  }

  // 3. Web search — the tool the Finder depends on.
  console.log("\n— Test 2: web search tool —");
  const toolTypes = ["web_search_20260209", "web_search_20250305"];
  let working = null;
  for (const type of toolTypes) {
    try {
      const r = await client.messages.create({
        model,
        max_tokens: 400,
        tools: [{ type, name: "web_search", max_uses: 1 }],
        messages: [
          {
            role: "user",
            content:
              "Use web search to find one recent news item about CCH Tagetik. Reply in one sentence.",
          },
        ],
      });
      const searched = r.content.some((b) => b.type === "web_search_tool_result");
      const text = r.content.find((b) => b.type === "text")?.text?.trim() ?? "";
      ok(`Web search works with tool type "${type}"`);
      info(searched ? "Search results were returned." : "No search block (model may not have needed one).");
      info(`Sample answer: ${text.slice(0, 160)}`);
      working = type;
      break;
    } catch (err) {
      bad(`Tool type "${type}" rejected.`);
      explain(err);
    }
  }

  if (!working) {
    bad("\nWeb search is not available — the Finder can't research.");
    info("Check that web search is enabled for your API account/organisation.");
    process.exit(1);
  }

  if (working !== toolTypes[0]) {
    info(
      `\nNote: the app prefers "${toolTypes[0]}" but will fall back to "${working}".`,
    );
  }

  console.log("\n🎉 All checks passed — agents should research successfully.\n");
}

main().catch((err) => {
  bad("Doctor hit an unexpected problem:");
  explain(err);
  process.exit(1);
});
