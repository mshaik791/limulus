import { createServer } from "node:http";
import type { AgentTurn } from "../sandbox/episode.ts";
import { askClaudeCli } from "./claude-cli.ts";

// Puts a Claude model behind the Lab's agent endpoint through the local
// Claude CLI, one model per port. The model agent (model-agent.ts) does the
// same for every provider at once, including claude-cli/*; this stays as the
// smallest possible bridge.
//
//   node src/experiments/claude-bridge.ts --port 8901 --model opus
//   then: node src/lab-cli.ts run http://localhost:8901/agent 3
//
// The methodology rules (neutral directory, no tools, closed stdin, a prompt
// that hints at nothing) live in claude-cli.ts.

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const port = Number(arg("--port", "8901"));
const model = arg("--model");
const timeoutMs = Number(arg("--timeout", "120000"));
const temperature = arg("--temperature") !== undefined ? Number(arg("--temperature")) : undefined;

let calls = 0;
let failures = 0;

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);

  // A malformed body must not take the bridge down. It once did: a stray probe
  // with an empty object threw inside this async handler, Node treated the
  // unhandled rejection as fatal, and the experiment still running against this
  // port recorded every subsequent episode as the agent refusing to pay.
  let turn: AgentTurn;
  try {
    turn = JSON.parse(Buffer.concat(chunks).toString("utf8")) as AgentTurn;
    if (!turn || typeof turn !== "object" || !Array.isArray(turn.tools) || typeof turn.task !== "string") {
      throw new Error("not an agent turn");
    }
  } catch (e) {
    console.error(`    rejected a malformed request: ${(e as Error).message}`);
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "expected an agent turn" }));
    return;
  }

  calls++;
  const { step, error } = await askClaudeCli(turn, model, timeoutMs);

  if (!step) {
    failures++;
    if (error) console.error(`    ${error}`);
    // Refusing to guess. A fabricated step would be recorded as the agent's
    // behaviour, and a harness that invents data is worse than one that stops.
    console.error(`    step ${turn.step}: no usable reply from the model (${failures} so far)`);
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "model produced no usable step" }));
    return;
  }

  // The bridge knows which model it invoked, so it says so on every step. The
  // Lab records that as self-reported, which is the most it is worth: an
  // endpoint's claim about itself cannot be checked from the outside.
  step.model = model ?? "claude-code-default";
  if (temperature !== undefined) step.temperature = temperature;

  const summary =
    step.type === "tool_call" ? `${step.tool}(${(JSON.stringify(step.args) ?? "{}").slice(0, 70)})` : `finish:${step.action}`;
  console.log(`    step ${turn.step}: ${summary}`);

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(step));
});

// Nothing in a long experiment should be able to kill the subject's endpoint.
process.on("uncaughtException", (e) => console.error(`    bridge caught: ${e.message}`));
process.on("unhandledRejection", (e) => console.error(`    bridge caught: ${String(e)}`));

server.listen(port, () => {
  console.log(`\n  claude bridge on http://localhost:${port}`);
  console.log(`  model      ${model ?? "(default)"}  reported to the Lab on every step`);
  console.log(`  temp       ${temperature ?? "(not declared)"}`);
  console.log(`  cwd        a fresh temp dir, so the agent cannot read this repo`);
  console.log(`  tools      filesystem and network disabled`);
  console.log(`  timeout    ${timeoutMs / 1000}s per step\n`);
});

process.on("SIGINT", () => {
  console.log(`\n  ${calls} model calls, ${failures} unusable\n`);
  process.exit(0);
});
