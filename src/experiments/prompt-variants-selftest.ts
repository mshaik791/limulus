import assert from "node:assert/strict";
import { isPromptVariant, promptFor, promptHash, promptHashes, VALIDATION_BLOCK } from "./agent-prompt.ts";
import type { AgentTurn } from "../sandbox/episode.ts";

// What a prompt version promises. Not what the prose says: that it is stable,
// that v1 is untouched by v2's existence, that a version cannot be confused
// with another, and that the block reveals nothing about the tests.
//
//   node src/experiments/prompt-variants-selftest.ts

const turn: AgentTurn = {
  task: "Pay invoice INV-1 from Acme.",
  authorization: { policyVersion: "v1", principal: "p", task: "t", limitPerPayment: 1, currency: "USD", approvedVendors: [], approvedInvoices: [], requiredChecks: [] },
  documents: [{ name: "a.pdf", type: "invoice", text: "Acme. Invoice INV-1. Total USD 1.00." }],
  tools: [{ name: "create_payment", parameters: ["amount"], description: "pay" }],
  history: [],
  step: 1,
  maxSteps: 8,
} as unknown as AgentTurn;

let n = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  n++;
  if (!cond) {
    console.error(`FAIL  ${label}  ${detail}`);
    process.exit(1);
  }
  console.log(`ok    ${label}${detail ? `  ${detail}` : ""}`);
};

const v1 = promptFor(turn);
const v2 = promptFor(turn, "v2");

ok("the default is v1, explicitly and by omission", v1 === promptFor(turn, "v1"));
ok("v1 carries none of the v2 block", !v1.includes("BEFORE YOU PROPOSE A PAYMENT"));
ok("v2 is v1 with exactly the block inserted, nothing else changed", v2.replace(VALIDATION_BLOCK, "") === v1);
ok("the block sits before the decision instruction, after the evidence", v2.indexOf(VALIDATION_BLOCK) < v2.indexOf("Decide the single next thing to do.") && v2.indexOf(VALIDATION_BLOCK) > v2.indexOf("WHAT YOU HAVE DONE SO FAR"));
ok("the block still asks for a payment when things reconcile", /pay it/i.test(VALIDATION_BLOCK));
ok("the block names no amount, vendor, scenario or test", !/\d|Northline|Cedar|scenario|test|grader/i.test(VALIDATION_BLOCK), "no digits, no fixture vendor, no word for the harness");

const hashes = promptHashes();
ok("each version hashes to a 64-hex sha256", Object.values(hashes).every((h) => /^[0-9a-f]{64}$/.test(h)));
ok("the two versions hash differently", hashes.v1 !== hashes.v2);
ok("a hash is stable across calls", promptHash("v2") === hashes.v2);
ok("a hash covers the template, not the scenario", promptHash("v1") === promptHash("v1") && !promptFor(turn, "v1").includes(hashes.v1));
ok("only known versions are versions", isPromptVariant("v1") && isPromptVariant("v2") && !isPromptVariant("v3") && !isPromptVariant("") && !isPromptVariant(undefined));

console.log(`\nAll ${n} prompt-version checks passed`);
