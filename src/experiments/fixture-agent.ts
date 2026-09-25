import { createServer } from "node:http";
import { naiveToolAgent } from "../sandbox/agents.ts";
import type { AgentTurn } from "../sandbox/episode.ts";

// A stand-in for a customer's agent, in its own process, for trying the
// connection flow end to end without a model or a key. It speaks the Lab's
// protocol exactly: one POSTed turn in, one step out.
//
//   node src/experiments/fixture-agent.ts [--port 9200] [--token <secret>]
//
// Behaviour is chosen per request by ?mode=, so one server can play every
// part the flow has to handle:
//
//   ok         (default) the scripted naive agent: pays what it is told to,
//              which produces real, graded failures
//   refuse     always finishes with "refuse": a usable answer, wrong or right
//   malformed  200 with HTML: an incompatible reply
//   stall      accepts the request and never answers: an unusable trial
//   slow       answers after a delay, for watching progress and cancellation
//
// With --token (or FIXTURE_TOKEN in the environment) every request must carry
// "Authorization: Bearer <token>"; anything else is 401, so the auth_failed
// path can be exercised. No secret is written anywhere by this file.

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const port = Number(arg("--port", "9200"));
const token = arg("--token", process.env.FIXTURE_TOKEN);
const slowMs = Number(arg("--slow-ms", "700"));

let calls = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, fixture: true, modes: ["ok", "refuse", "malformed", "stall", "slow"], calls }));
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }
  if (token && req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let turn: AgentTurn & { check?: boolean };
  try {
    turn = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "expected a turn" }));
  }
  calls++;
  const mode = url.searchParams.get("mode") ?? "ok";
  const reply = (step: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    // Explicit provenance: this is a stand-in, and "mode" names its behaviour, not a model.
    res.end(JSON.stringify({ ...(step as object), model: `fixture/${mode}`, fixture: true }));
  };
  const label = turn.check ? "connection check" : `step ${turn.step}`;
  switch (mode) {
    case "stall":
      console.log(`  [stall] ${label}: not answering`);
      return;
    case "malformed":
      console.log(`  [malformed] ${label}: replying with HTML`);
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html><body>not an agent</body></html>");
    case "refuse":
      console.log(`  [refuse] ${label}`);
      return reply({ type: "finish", action: "refuse", reason: "fixture refuses everything" });
    case "slow":
      await new Promise((r) => setTimeout(r, slowMs));
      console.log(`  [slow] ${label}: answered after ${slowMs}ms`);
      return reply(turn.check ? { type: "finish", action: "refuse", reason: "check" } : naiveToolAgent(turn));
    default: {
      const step = turn.check ? { type: "finish", action: "refuse", reason: "connection check acknowledged" } : naiveToolAgent(turn);
      console.log(`  [ok] ${label}: ${step.type === "tool_call" ? step.tool : `finish:${step.action}`}`);
      return reply(step);
    }
  }
});

server.listen(port, () => {
  console.log(`\n  fixture agent on http://localhost:${port}/agent?mode=ok|refuse|malformed|stall|slow`);
  console.log(`  auth       ${token ? "Bearer token required" : "none"}\n`);
});
