import { createServer } from "node:http";
import { isTurn, parseStep, promptFor } from "./agent-prompt.ts";
import type { AgentStep, AgentTurn } from "../sandbox/episode.ts";

// Puts any chat model behind the Lab's agent endpoint, through an
// OpenAI-compatible chat-completions API. The default base URL is Vercel's AI
// Gateway, which reaches Anthropic, OpenAI, Google and others with one
// credential; any other compatible server works with --base-url.
//
//   node --env-file=.env.local src/experiments/model-agent.ts \
//     --models anthropic/claude-sonnet-4.5,openai/gpt-4.1,google/gemini-2.5-pro
//
//   then each model is an arm:
//     node src/lab-cli.ts compare \
//       "Claude Sonnet=http://localhost:9100/agent?model=anthropic/claude-sonnet-4.5:off" \
//       "GPT-4.1=http://localhost:9100/agent?model=openai/gpt-4.1:off" \
//       "Gemini 2.5 Pro=http://localhost:9100/agent?model=google/gemini-2.5-pro:off" --trials 3
//
// Credentials, in order: AI_GATEWAY_API_KEY, VERCEL_OIDC_TOKEN (what
// `vercel env pull` writes for a linked project), OPENAI_API_KEY. Never
// printed. Zero dependencies: fetch is enough.
//
// Same three rules as the Claude bridge. The prompt hints at nothing. A reply
// that is not a usable step is a 502, never an invented refusal, so the Lab
// records an unusable episode rather than behaviour that did not happen. And
// the endpoint says which model it invoked on every step, which the Lab
// records as self-reported: the most an endpoint's claim about itself is worth.

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const port = Number(arg("--port", "9100"));
const baseUrl = (arg("--base-url", process.env.AI_GATEWAY_BASE_URL ?? "https://ai-gateway.vercel.sh/v1") ?? "").replace(/\/$/, "");
const allowed = (arg("--models", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const temperature = Number(arg("--temperature", "0"));
const timeoutMs = Number(arg("--timeout", "90000"));
const maxTokens = Number(arg("--max-tokens", "400"));
const key = process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_OIDC_TOKEN ?? process.env.OPENAI_API_KEY;

if (allowed.length === 0) {
  console.error("  --models is required: a comma-separated list of provider/model ids from the gateway's /v1/models");
  process.exit(2);
}
if (!key) {
  console.error("  No credential. Set AI_GATEWAY_API_KEY, or run with --env-file=.env.local after `vercel env pull`, or set OPENAI_API_KEY for a direct base URL.");
  process.exit(2);
}

const stats = new Map<string, { calls: number; failures: number; ms: number }>();

async function ask(model: string, turn: AgentTurn): Promise<{ step: AgentStep | null; reported?: string; ms: number; error?: string }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: "You reply with exactly one JSON object and nothing else." },
          { role: "user", content: promptFor(turn) },
        ],
      }),
    });
    const text = await res.text();
    if (!res.ok) return { step: null, ms: Date.now() - started, error: `${res.status} ${text.slice(0, 200)}` };
    const body = JSON.parse(text) as { model?: string; choices?: { message?: { content?: string | { text?: string }[] } }[] };
    const raw = body.choices?.[0]?.message?.content;
    const content = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p) => p.text ?? "").join("") : "";
    return { step: parseStep(content), reported: body.model, ms: Date.now() - started, error: parseStep(content) ? undefined : `unparseable reply: ${content.slice(0, 120)}` };
  } catch (e) {
    return { step: null, ms: Date.now() - started, error: (e as Error).name === "AbortError" ? `timeout after ${timeoutMs}ms` : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, baseUrl, models: allowed, stats: Object.fromEntries(stats) }));
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }
  const model = url.searchParams.get("model") ?? allowed[0];
  if (!allowed.includes(model)) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: `model ${model} is not in --models` }));
  }

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let turn: unknown;
  try {
    turn = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    turn = null;
  }
  if (!isTurn(turn)) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "expected an agent turn" }));
  }

  const s = stats.get(model) ?? { calls: 0, failures: 0, ms: 0 };
  s.calls++;
  const { step, reported, ms, error } = await ask(model, turn);
  s.ms += ms;
  if (!step) {
    s.failures++;
    stats.set(model, s);
    console.error(`    [${model}] step ${turn.step}: no usable reply (${error})`);
    res.writeHead(502, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "model produced no usable step", detail: error }));
  }
  stats.set(model, s);
  step.model = model;
  if (reported && reported !== model) step.modelVersion = reported;
  step.temperature = temperature;
  const summary = step.type === "tool_call" ? `${step.tool}(${(JSON.stringify(step.args) ?? "{}").slice(0, 60)})` : `finish:${step.action}`;
  console.log(`    [${model}] step ${turn.step}: ${summary}  ${ms}ms`);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(step));
});

process.on("uncaughtException", (e) => console.error(`    model agent caught: ${e.message}`));
process.on("unhandledRejection", (e) => console.error(`    model agent caught: ${String(e)}`));

server.listen(port, () => {
  console.log(`\n  model agent on http://localhost:${port}/agent?model=<id>`);
  console.log(`  base   ${baseUrl}`);
  console.log(`  models ${allowed.join(", ")}`);
  console.log(`  credential ${process.env.AI_GATEWAY_API_KEY ? "AI_GATEWAY_API_KEY" : process.env.VERCEL_OIDC_TOKEN ? "VERCEL_OIDC_TOKEN" : "OPENAI_API_KEY"} (not shown)\n`);
});
