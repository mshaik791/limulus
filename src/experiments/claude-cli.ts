import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentStep, AgentTurn } from "../sandbox/episode.ts";
import { parseStepDetail, promptFor, type PromptVariant } from "./agent-prompt.ts";

// One step from a Claude model through the local Claude CLI: no API key, the
// CLI's own login. Shared by the Claude bridge and the model agent.
//
// Three methodology rules, each learned the hard way earlier in this project:
//
//   The working directory is a fresh temp dir, and every filesystem and network
//   tool is disabled. Given the chance to read this repository, an agent worked
//   out it was inside a test of itself and said so in its answer.
//
//   stdin is closed rather than left as an idle pipe. Left open, the model can
//   sit waiting on input that never arrives and end its turn early, which once
//   produced a 100% friction figure for behaviour that did not reproduce by hand.
//
//   Nothing in the prompt tells the model what the right answer is, names the
//   scenario family, or mentions what is under study. A prompt that hints at
//   the hypothesis measures the hint.

export const claudeBin = process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`;
const neutralDir = mkdtempSync(join(tmpdir(), "limulus-agent-"));

/** One model call. Null if it could not produce a usable step within the timeout. */
export function askClaudeCli(turn: AgentTurn, model: string | undefined, timeoutMs: number, prompt: PromptVariant = "v1"): Promise<{ step: AgentStep | null; error?: string }> {
  return new Promise((resolve) => {
    const args = ["-p", promptFor(turn, prompt), "--disallowedTools", "Read,Write,Edit,Bash,Glob,Grep,WebFetch,WebSearch,Task,TodoWrite,NotebookEdit"];
    if (model) args.push("--model", model);

    // Claude Code refuses to start inside another Claude Code session. The
    // bridge is often launched from one, so the nesting markers are dropped;
    // the subject still gets no tools and a neutral directory.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const child = spawn(claudeBin, args, { cwd: neutralDir, env, stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const killer = setTimeout(() => {
      child.kill();
      resolve({ step: null, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ step: null, error: e.message });
    });
    child.on("close", () => {
      clearTimeout(killer);
      const { step, normalised } = parseStepDetail(out, turn.tools.map((t) => t.name));
      if (normalised) console.log(`    [claude-cli/${model ?? "default"}] step ${turn.step}: ${normalised}`);
      resolve(step ? { step } : { step: null, error: err.trim().slice(0, 160) || `unparseable reply: ${out.trim().slice(0, 120)}` });
    });
  });
}
