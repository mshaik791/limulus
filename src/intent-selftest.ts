import { recordIntent, verifyIntent, verifyIntentChain, readIntentsForAgent, requireIntent, hashDocuments, type IntentRecord } from "./intent.ts";

// The one property that must hold: a single altered byte, an inserted record or a
// removed one breaks chain verification. Plus: an order with no intent record
// escalates, and two agents' chains stay independent. No model, no network.
//
//   node src/intent-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// A fresh agent per run so the chain under test is isolated from earlier runs.
const agent = `agent-selftest-${Date.now()}`;
const other = `${agent}-other`;
const t = (n: number) => new Date(Date.parse("2026-09-21T00:00:00Z") + n * 1000).toISOString();

const declared = (invoiceId: string, amount: number, acct = "2210") => ({
  invoiceId, payeeName: "Northline Steel", payeeAccountLast4: acct, amount, currency: "USD", rail: "ach",
});
const docs = hashDocuments([{ name: `${"INV"}.pdf`, text: "Northline Steel. Total USD 64,000.00." }]);
const base = { configHash: "cfg-abc", mandateId: "mnd-1", model: { name: "ref-careful", version: "0.3.1", source: "configured" as const }, documentHashes: docs };

// Record three intents for one agent, interleaving another agent's record.
const r1 = recordIntent({ agentId: agent, runId: "run-1", declared: declared("INV-1", 64_000), createdAt: t(0), ...base });
recordIntent({ agentId: other, runId: "run-x", declared: declared("INV-9", 5_000), createdAt: t(1), ...base });
const r2 = recordIntent({ agentId: agent, runId: "run-2", declared: declared("INV-2", 31_500), createdAt: t(2), ...base });
const r3 = recordIntent({ agentId: agent, runId: "run-3", declared: declared("INV-3", 12_450), createdAt: t(3), ...base });

check("each record verifies on its own", [r1, r2, r3].every((r) => verifyIntent(r).ok));
check("a fresh agent chain starts with prevHash null", r1.prevHash === null);
check("each record links to the previous one for that agent", r2.prevHash === r1.hash && r3.prevHash === r2.hash);
check("the whole agent chain verifies", verifyIntentChain(agent).ok, verifyIntentChain(agent).problems.map((p) => p.problem).join("; "));
check("chains are per-agent (the other agent did not disturb this one)", readIntentsForAgent(agent).length === 3);

// Tamper: change one byte of a record's body without re-signing.
const chain = readIntentsForAgent(agent);
const tampered: IntentRecord = structuredClone(chain[1]);
tampered.declared.amount = tampered.declared.amount + 1; // 31,500 -> 31,501
check("a single altered byte fails single-record verification", !verifyIntent(tampered).ok);
const tamperedChain = [chain[0], tampered, chain[2]];
check("an altered record breaks chain verification", !verifyIntentChain(agent, tamperedChain).ok);

// Removal: drop the middle record; the next record's prevHash no longer matches.
const removedChain = [chain[0], chain[2]];
check("a removed record breaks chain verification (a gap is detected)", !verifyIntentChain(agent, removedChain).ok);

// Insertion: splice a foreign record in; its prevHash will not match.
const foreign = recordIntent({ agentId: `${agent}-z`, runId: "run-z", declared: declared("INV-Z", 1), createdAt: t(4), ...base });
check("an inserted record breaks chain verification", !verifyIntentChain(agent, [chain[0], foreign, chain[1], chain[2]]).ok);

// Protect: an order with no intent record escalates; one with a verified intent proceeds.
const missing = requireIntent(agent, "run-1", "INV-DOES-NOT-EXIST");
check("an order with no intent record escalates", missing.verdict === "escalate" && !missing.present);
const present = requireIntent(agent, "run-1", "INV-1");
check("an order backed by a verified intent proceeds", present.verdict === "proceed" && present.present);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
