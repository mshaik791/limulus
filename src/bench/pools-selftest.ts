import { runSuite } from "../sandbox/lab.ts";
import { referenceToolAgents } from "../sandbox/agents.ts";
import {
  cohortAlreadyUsed, hasHeldOut, heldOutPool, leakCheck, openPool, PoolError,
} from "./pools.ts";
import { FAMILIES } from "./families.ts";

// Checks the property the whole split exists for: that a qualification cannot
// be issued from scenarios the agent's authors could have read.
//
//   node src/bench/pools-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const open = await openPool();
check("the open pool loads", open.length > 0, `${open.length} scenarios`);
check("every open scenario is marked open", open.every((s) => s.pool === "open"));

if (!hasHeldOut()) {
  console.log("\nNo held-out pool present. Generate one first:");
  console.log("  node src/bench/generate-held-out.ts\n");
  process.exit(1);
}

const held = heldOutPool();
check("the held-out pool loads", held.length > 0, `${held.length} scenarios`);
check("every held-out scenario is marked held-out", held.every((s) => s.pool === "held-out"));
check("every held-out scenario belongs to a cohort", held.every((s) => Boolean(s.cohort)));

// ---- the pools must not overlap ---------------------------------------
const leak = leakCheck(open, held);
check("no scenario id appears in both pools", leak.sharedIds.length === 0, leak.sharedIds.join(", "));
check("no held-out scenario duplicates open content", leak.identicalContent.length === 0,
  leak.identicalContent.join(", "));

// ---- the threat model is public, the instances are not ----------------
check("every family publishes what it tests", FAMILIES.every((f) => f.tests.length > 20));
check("every family cites a source", FAMILIES.every((f) => f.source.length > 5));
check("held-out instances all come from a published family",
  held.every((s) => FAMILIES.some((f) => s.id.startsWith(`held-${f.key}-`))));

// ---- the guard ---------------------------------------------------------
const scope = {
  workflow: "invoice-payment", rail: "ach", currency: "USD",
  amountLimit: 5_000, approvalPolicy: "A person approves above the ceiling.",
  payeeScope: "on-file" as const,
};

let refused = false;
try {
  await runSuite(referenceToolAgents.careful, { pool: "open", trials: 1, qualifyFor: scope });
} catch (error) {
  refused = error instanceof PoolError && error.code === "qualification_requires_held_out";
}
check("a qualification cannot be issued from the open pool", refused);

// The loophole: supplying your own pack must not get you past the guard.
let packRefused = false;
try {
  await runSuite(referenceToolAgents.careful, {
    pool: "held-out", trials: 1, qualifyFor: scope, pack: open.slice(0, 2), allowRetake: true,
  });
} catch (error) {
  packRefused = error instanceof PoolError && error.code === "pack_not_held_out";
}
check("an explicit pack of open scenarios is refused too", packRefused);

// ---- a held-out run can qualify, once -----------------------------------
const cohort = held[0].cohort!;
const agent = referenceToolAgents.careful;
const version = agent.version ?? "unversioned";
const seenBefore = cohortAlreadyUsed(cohort, agent.name, version);

const { run, qualification } = await runSuite(agent, {
  pool: "held-out", trials: 1, qualifyFor: scope, allowRetake: true,
});
check("a held-out run records which pool it was", run.pool === "held-out", run.pool);
check("a held-out run records its cohort", run.cohort === cohort, String(run.cohort));
check("a held-out run can issue a qualification", Boolean(qualification), qualification?.level ?? "none");
check("the qualification names the held-out suite",
  Boolean(qualification?.binding.suite.id.startsWith("held-out:")),
  qualification?.binding.suite.id ?? "");
check("the cohort is burned for this agent version",
  cohortAlreadyUsed(cohort, agent.name, version),
  seenBefore ? "(was already recorded)" : "recorded now");

console.log(
  failures === 0
    ? "\nAll pool checks passed. A qualification requires scenarios the agent has not seen,\n" +
      "and there is no argument shape that gets around that."
    : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
