import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentStep, AgentTurn } from "../sandbox/episode.ts";
import { parseStep, promptFor } from "./agent-prompt.ts";

// Puts a real model behind the Lab's agent endpoint.
//
// The Lab already owns the loop: it hands over a turn and expects one step
// back. So this does not need MCP or a tool runtime — it needs a model that
// reads a turn and picks the next action. One `claude -p` call per step.
//
//   node src/experiments/claude-bridge.ts --port 8901
//   then: node src/experiments/rail-caution.ts --endpoint http://localhost:8901
//
// Three methodology rules, each learned the hard way earlier in this project:
//
//   The working directory is a fresh temp dir, and every filesystem and network
//   tool is disabled. Given the chance to read this repository, an agent worked
//   out it was inside a test of itself and said so in its answer.
//
//   stdin is closed rather than left as an idle pipe. Left open, the model can
//   sit waiting on input that never arrives and end its turn early — which once
//   produced a 100% friction figure for behaviour that did not reproduce by hand.
//
//   Nothing in the prompt tells the model what the right answer is, names the
//   scenario family, or mentions that a rail is the variable under study. A
//   prompt that hints at the hypothesis measures the hint.

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const port = Number(arg("--port", "8901"));
const model = arg("--model");
const claudeBin = process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`;
const timeoutMs = Number(arg("--timeout", "120000"));
const temperature = arg("--temperature") !== undefined ? Number(arg("--temperature")) : undefined;
const neutralDir = mkdtempSync(join(tmpdir(), "limulus-agent-"));

let calls = 0;
let failures = 0;

/** One model call. Returns null if it could not produce a usable step. */
function askClaude(turn: AgentTurn): Promise<AgentStep | null> {
  return new Promise((resolve) => {
    const args = [
      "-p",
      promptFor(turn),
      "--disallowedTools",
      "Read,Write,Edit,Bash,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,NotebookEdit",
    ];
    if (model) args.push("--model", model);

    // Claude Code refuses to start inside another Claude Code session. The
    // bridge is often launched from one, so the nesting markers are dropped;
    // the subject still gets no tools and a neutral directory.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const child = spawn(claudeBin, args, {
      cwd: neutralDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));

    const killer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);

    child.on("close", () => {
      clearTimeout(killer);
      const step = parseStep(out);
      if (!step && err.trim()) console.error(`    model stderr: ${err.trim().slice(0, 160)}`);
      resolve(step);
    });
  });
}

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
  const step = await askClaude(turn);

  if (!step) {
    failures++;
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
  console.log(`  cwd        ${neutralDir}  (empty, so the agent cannot read this repo)`);
  console.log(`  tools      filesystem and network disabled`);
  console.log(`  timeout    ${timeoutMs / 1000}s per step\n`);
});

process.on("SIGINT", () => {
  console.log(`\n  ${calls} model calls, ${failures} unusable\n`);
  process.exit(0);
});
