import { createServer } from "node:http";
import { isTurn, parseStepDetail, promptFor } from "./agent-prompt.ts";
import { askClaudeCli } from "./claude-cli.ts";
import { CLAUDE_CLI, catalog, configured, resolve, type CatalogEntry } from "./providers.ts";
import type { AgentStep, AgentTurn } from "../sandbox/episode.ts";

// Puts any chat model behind the Lab's agent endpoint. One server, one prompt,
// a model per arm chosen by query string:
//
//   node --env-file=.env.local src/experiments/model-agent.ts
//
//   node src/lab-cli.ts compare \
//     "GPT-4o mini=http://localhost:9100/agent?model=openai/gpt-4o-mini:off" \
//     "Gemini 2.5 Flash=http://localhost:9100/agent?model=google/gemini-2.5-flash:off" \
//     "Claude Sonnet=http://localhost:9100/agent?model=claude-cli/sonnet:off" --trials 3
//
// Routing is in providers.ts: a provider's own key when present, otherwise a
// gateway that serves every vendor (OpenRouter, or Vercel's AI Gateway), and
// the local Claude CLI for claude-cli/*. --models
// restricts the ids this server will accept; without it any id with a route
// is accepted, so a new model needs no code. GET /health lists the providers
// with a credential and the models they say they serve.
//
// Three rules. The prompt hints at nothing. A reply that is not a usable step
// is a 502, never an invented refusal, so the Lab records an unusable episode
// rather than behaviour that did not happen. And the endpoint says which model
// it invoked on every step, which the Lab records as self-reported: the most
// an endpoint's claim about itself is worth.

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const port = Number(arg("--port", "9100"));
const allowed = (arg("--models", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const via = (arg("--via", "auto") ?? "auto") as "auto" | "direct" | "gateway";
const temperature = Number(arg("--temperature", "0"));
const timeoutMs = Number(arg("--timeout", "120000"));
// Reasoning models spend part of the budget thinking before the JSON; a
// budget that is too small truncates the step, which is then rightly unusable.
const maxTokens = Number(arg("--max-tokens", "4000"));

const providers = configured();
if (providers.length === 0) console.log("  No provider credential in the environment: only claude-cli/* models will work. See src/experiments/providers.ts for the variables.");
for (const id of allowed) {
  const { route, reason } = resolve(id, via);
  if (!route) {
    console.error(`  ${id}: ${reason}`);
    process.exit(2);
  }
}

const stats = new Map<string, { calls: number; failures: number; ms: number }>();
let cached: { at: number; entries: CatalogEntry[]; problems: string[] } | null = null;
async function models(): Promise<{ entries: CatalogEntry[]; problems: string[] }> {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached;
  const c = await catalog();
  const cli: CatalogEntry[] = ["opus", "sonnet", "haiku"].map((m) => ({ id: `${CLAUDE_CLI}/${m}`, provider: CLAUDE_CLI, via: "claude-cli" }));
  cached = { at: Date.now(), entries: [...cli, ...c.entries], problems: c.problems };
  return cached;
}

async function ask(id: string, turn: AgentTurn): Promise<{ step: AgentStep | null; reported?: string; ms: number; error?: string }> {
  const started = Date.now();
  const { route, reason } = resolve(id, via);
  if (!route) return { step: null, ms: 0, error: reason };
  if (route.provider.key === CLAUDE_CLI) {
    // The CLI starts a whole session per step; give it longer than an API call.
    const r = await askClaudeCli(turn, route.model, Math.max(timeoutMs, 240_000));
    return { ...r, ms: Date.now() - started };
  }
  const { provider, key, model } = route as { provider: { baseUrl: string }; key: string; model: string };
  const body = JSON.stringify({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: "You reply with exactly one JSON object and nothing else." },
      { role: "user", content: promptFor(turn) },
    ],
  });
  // A rate limit or a provider outage is transport, not behaviour: back off
  // and try again within the step's time budget. Anything else is final, and
  // a reply that is not a step is never repaired into one.
  const waits = [5_000, 15_000, 30_000, 60_000];
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs - (Date.now() - started)));
    try {
      const res = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", signal: controller.signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body });
      const text = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < waits.length && Date.now() - started + waits[attempt] < timeoutMs) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 90_000) : waits[attempt];
        console.log(`    [${id}] step ${turn.step}: ${res.status}, retrying in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) return { step: null, ms: Date.now() - started, error: `${res.status} ${text.slice(0, 200)}` };
      const parsed = JSON.parse(text) as { model?: string; choices?: { message?: { content?: string | { text?: string }[] } }[] };
      const raw = parsed.choices?.[0]?.message?.content;
      const content = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((p) => p.text ?? "").join("") : "";
      const { step, normalised } = parseStepDetail(content, turn.tools.map((t) => t.name));
      if (normalised) console.log(`    [${id}] step ${turn.step}: ${normalised}`);
      return { step, reported: parsed.model, ms: Date.now() - started, error: step ? undefined : `unparseable reply: ${content.slice(0, 120)}` };
    } catch (e) {
      return { step: null, ms: Date.now() - started, error: (e as Error).name === "AbortError" ? `timeout after ${timeoutMs}ms` : (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}

const server = createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/models")) {
    const m = await models();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: true,
        endpoint: `http://localhost:${port}/agent?model=<id>`,
        via,
        providers: [{ key: CLAUDE_CLI, label: "Claude CLI" }, ...providers.map((p) => ({ key: p.key, label: p.label }))],
        allowed: allowed.length ? allowed : null,
        models: allowed.length ? m.entries.filter((e) => allowed.includes(e.id)) : m.entries,
        problems: m.problems,
        stats: Object.fromEntries(stats),
      }),
    );
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }
  const model = url.searchParams.get("model") ?? allowed[0];
  if (!model) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "say which model: POST /agent?model=<provider>/<model>" }));
  }
  if (allowed.length && !allowed.includes(model)) {
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
  if (reported && reported !== model && !model.endsWith(`/${reported}`)) step.modelVersion = reported;
  step.temperature = temperature;
  const summary = step.type === "tool_call" ? `${step.tool}(${JSON.stringify(step.args).slice(0, 60)})` : `finish:${step.action}`;
  console.log(`    [${model}] step ${turn.step}: ${summary}  ${ms}ms`);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(step));
});

process.on("uncaughtException", (e) => console.error(`    model agent caught: ${e.message}`));
process.on("unhandledRejection", (e) => console.error(`    model agent caught: ${String(e)}`));

server.listen(port, async () => {
  console.log(`\n  model agent on http://localhost:${port}/agent?model=<provider>/<model>`);
  console.log(`  routes     claude-cli (no key)${providers.length ? ", " + providers.map((p) => p.label).join(", ") : ""}  (credentials not shown)`);
  console.log(`  models     ${allowed.length ? allowed.join(", ") : "any id with a route; GET /health lists what the providers serve"}`);
  console.log(`  temp       ${temperature}   timeout ${timeoutMs / 1000}s per step\n`);
  const m = await models();
  for (const p of m.problems) console.log(`  note       ${p}`);
});
