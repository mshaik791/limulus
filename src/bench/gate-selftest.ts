import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGateRecords, verifyGateRecord } from "./gate-record.ts";

// The override is the one place discretion enters the gate, so this drives the
// gate end to end as a process and checks every edge of it: a critical cannot
// be overridden, an accepted failure passes, a failure outside the accepted
// list does not, an edited override does not, an expired one does not, and
// every run leaves a sealed record.
//
//   node src/bench/gate-selftest.ts

const here = dirname(fileURLToPath(import.meta.url));
const gate = join(here, "ci-gate.ts");
const repoScenarios = join(here, "..", "..", "scenarios");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// A scratch suite: the repository's committed scenario files, without its
// baseline or overrides.
const dir = mkdtempSync(join(tmpdir(), "limulus-gate-"));
for (const f of ["bank-change-hidden-in-thread.scenario.json", "duplicate-invoice-resubmitted.scenario.json"]) {
  cpSync(join(repoScenarios, f), join(dir, f));
}

// An agent that refuses everything. It never moves money, so it can never
// produce a critical violation; it fails the clean scenarios instead. That is
// exactly the failure shape a person may legitimately accept for a while.
//
// It runs as its own process: the gate is driven with spawnSync below, which
// blocks this process's event loop, and a server in here could never answer.
const refuserPort = 8797;
const refuser = spawn(
  process.execPath,
  [
    "-e",
    `require("node:http").createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(200, {"content-type": "application/json"}); res.end(JSON.stringify({ type: "finish", action: "refuse", reason: "selftest refuser" })); }); }).listen(${refuserPort});`,
  ],
  { stdio: "ignore" },
);
await new Promise((r) => setTimeout(r, 600));
const refuserUrl = `http://localhost:${refuserPort}/agent`;

const run = (...args: string[]) => {
  const r = spawnSync(process.execPath, [gate, ...args], { encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};
const common = ["--scenarios", dir, "--trials", "1"];
const recordsBefore = readGateRecords().length;

// 1. Baseline from the careful agent.
let r = run(...common, "--agent", "careful", "--update-baseline");
check("baseline written from the careful agent", r.code === 0 && existsSync(join(dir, "baseline.json")), r.out.slice(-300));

// 2. The careful agent passes its own baseline, and a record is sealed.
r = run(...common, "--agent", "careful");
check("the careful agent passes its own baseline", r.code === 0 && r.out.includes("PASS"), r.out.slice(-300));
check("a gate record was sealed", r.out.includes("sealed    gate_"));
let last = readGateRecords().at(-1)!;
check("the record verifies and says pass", verifyGateRecord(last).ok && last.verdict === "pass");

// 3. The naive agent fails with new critical violations; override is refused.
r = run(...common, "--agent", "naive");
check("the naive agent fails the gate", r.code === 1 && r.out.includes("NEW CRITICAL"), r.out.slice(-400));
last = readGateRecords().at(-1)!;
check("the failing run is sealed as fail with its criticals named", last.verdict === "fail" && last.newCriticals.length > 0);
r = run("override", ...common, "--agent", "naive", "--actor", "selftest", "--reason", "trying to wave through a critical, which must not work");
check("a new critical violation cannot be overridden", r.code === 1 && r.out.includes("REFUSED"), r.out.slice(-300));
check("and no overrides file was written", !existsSync(join(dir, "overrides.json")));

// 4. The refuser fails without criticals: a scenario it now fails, or an axis
// that dropped, but never money moving.
r = run(...common, "--agent", refuserUrl);
check("the refuser fails the gate without criticals", r.code === 1 && !r.out.includes("NEW CRITICAL") && /NEWLY FAILING|SCORES DOWN/.test(r.out), r.out.slice(-400));
const agentName = `localhost:${refuserPort}`;

// 5. Override needs a reason.
r = run("override", ...common, "--agent", refuserUrl, "--actor", "selftest", "--reason", "short");
check("an override with a one-word reason is refused", r.code === 2);

// 6. A proper override is written and honoured.
r = run("override", ...common, "--agent", refuserUrl, "--actor", "selftest", "--reason", "The refuser is a placeholder while the real agent is offline; accepted for the sprint.");
check("an override is written", r.code === 0 && existsSync(join(dir, "overrides.json")), r.out.slice(-300));
const overrides = JSON.parse(readFileSync(join(dir, "overrides.json"), "utf8"));
check("it names the agent and what it covers", overrides[0].agent === agentName && overrides[0].covers.length > 0, JSON.stringify(overrides[0].covers));

r = run(...common, "--agent", refuserUrl);
check("the same failure now passes as overridden", r.code === 0 && r.out.includes("OVERRIDDEN by selftest"), r.out.slice(-400));
last = readGateRecords().at(-1)!;
check("the sealed record says overridden and carries the reason", last.verdict === "overridden" && last.override?.actor === "selftest" && verifyGateRecord(last).ok);

// 7. The override does not cover a different agent's failure.
r = run(...common, "--agent", "naive");
check("the override does not cover another agent", r.code === 1 && r.out.includes("FAIL"));

// 8. An edited override is void.
const edited = [{ ...overrides[0], reason: "edited after the fact" }];
writeFileSync(join(dir, "overrides.json"), JSON.stringify(edited));
r = run(...common, "--agent", refuserUrl);
check("an override edited after it was written no longer applies", r.code === 1 && r.out.includes("hash mismatch"), r.out.slice(-400));

// 9. An expired override is void.
const expired = [{ ...overrides[0] }];
writeFileSync(join(dir, "overrides.json"), JSON.stringify(expired));
r = run("override", ...common, "--agent", refuserUrl, "--actor", "selftest", "--reason", "A second override, written to expire immediately, to prove expiry is enforced.", "--days", "0");
check("a zero-day override is written", r.code === 0);
// Restore the untouched first override alongside the expired one, but with the
// first one voided, so only the expired one could apply.
const both = JSON.parse(readFileSync(join(dir, "overrides.json"), "utf8"));
writeFileSync(join(dir, "overrides.json"), JSON.stringify([{ ...both[0], covers: [] }, both[1]]));
r = run(...common, "--agent", refuserUrl);
check("an expired override does not apply", r.code === 1 && /expired|does not cover/.test(r.out), r.out.slice(-400));

check("every gate run in this test left a verifying record", readGateRecords().slice(recordsBefore).every((g) => verifyGateRecord(g).ok));

refuser.kill();
rmSync(dir, { recursive: true, force: true });

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All gate checks passed");
