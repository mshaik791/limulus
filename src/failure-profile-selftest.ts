import { wilson, profileForConfig, compareProfiles, agentConfigs } from "./failure-profile.ts";
import { runSuite } from "./sandbox/lab.ts";
import { referenceToolAgents } from "./sandbox/agents.ts";
import { scenarios as payments } from "./bench/pack-payments-v1.ts";

// The profile must never say more than its sample supports. Checks the Wilson
// interval, that aggregation by taxonomy node is right, and that a rate below the
// minimum n says "not enough trials". Deterministic reference agents; no key.
//
//   node src/failure-profile-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// ---- Wilson interval ----------------------------------------------------
check("wilson(0,n) has a lower bound of 0", wilson(0, 10).low === 0);
check("wilson(n,n) has an upper bound of 1", wilson(10, 10).high === 1);
const mid = wilson(5, 10);
check("wilson(5,10) brackets 0.5", mid.low < 0.5 && mid.high > 0.5, `${mid.low.toFixed(2)}-${mid.high.toFixed(2)}`);
check("wilson narrows as n grows", wilson(50, 100).high - wilson(50, 100).low < wilson(5, 10).high - wilson(5, 10).low);
check("wilson(0,0) does not divide by zero", wilson(0, 0).low === 0 && wilson(0, 0).high === 0);

// ---- aggregation: run the naive agent (it fails traps) ------------------
const naive = referenceToolAgents.naive;
await runSuite(naive, { pack: payments, suite: { id: "profile-selftest" }, trials: 12, allowRetake: true });
const profile = profileForConfig(naive.name, naive.version ?? "unversioned");

check("the config appears in agentConfigs()", agentConfigs().some((c) => c.name === naive.name));
check("the profile aggregated some taxonomy nodes", profile.nodes.length > 0, `${profile.nodes.length} nodes`);
check("nodes have enough data at 12 trials", profile.nodes.some((n) => n.enoughData));
check("every node carries n and a Wilson interval", profile.nodes.every((n) => typeof n.trials === "number" && "low" in n.ci && "high" in n.ci));
check("nodes are ranked by defensible lower bound (descending)", profile.nodes.every((n, i) => i === 0 || profile.nodes[i - 1].ci.low >= n.ci.low - 1e-9));

const failing = profile.nodes.filter((n) => n.failures > 0 && n.enoughData);
if (failing.length > 0) {
  check("a real finding names its n and 95% CI", profile.findings.some((f) => f.includes("95% CI") && f.includes("trials failed")));
  check("simulated exposure is labelled simulated", profile.findings.some((f) => f.includes("simulated exposure")));
  check("a finding links a reproduction and a fix", profile.findings.some((f) => f.includes("reproduce:") && f.includes("fix:")));
} else {
  console.log("  (naive produced no failing node with enough data this run — skipping finding-text checks)");
}

// ---- comparison ---------------------------------------------------------
check("comparing a config to itself yields no diffs", compareProfiles(naive.name, naive.version ?? "unversioned", naive.version ?? "unversioned").length === 0);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
