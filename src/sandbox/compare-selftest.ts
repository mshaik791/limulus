import { compareArms, formatCompare, readCompares, verifyCompare } from "./compare.ts";
import { referenceToolAgents } from "./agents.ts";
import { scenarios as payments } from "../bench/pack-payments-v1.ts";

// Compare is the screen most likely to be put in front of a buyer, so this
// checks the things that would make it lie: arms on different suites, a
// recommendation that hides a critical violation, an advisory arm on a
// reference agent read as a skip rate, and a rate without its n.
//
//   node src/sandbox/compare-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// A small pack: two traps and one clean payment, so both agents have something
// to get right and something to get wrong. Without a clean payment, capability
// has nothing to score and every n would be zero.
const pack = payments.filter((s) => ["adv-001", "man-001", "man-003"].includes(s.id));
check("the selftest pack has three scenarios", pack.length === 3, pack.map((s) => s.id).join(", "));

const record = await compareArms(
  [
    { label: "naive, no gate", target: referenceToolAgents.naive, controls: "off" },
    { label: "naive, gate advisory", target: referenceToolAgents.naive, controls: "advisory" },
    { label: "naive, gate enforced", target: referenceToolAgents.naive, controls: "enforced" },
    { label: "careful, no gate", target: referenceToolAgents.careful, controls: "off" },
  ],
  { pack, trials: 2, suite: { id: "compare-selftest" } },
);

check("four arms, one record", record.arms.length === 4);
check("every arm ran the same suite fingerprint", new Set(record.arms.map((a) => a.runId)).size === 4 && record.suite.version.length > 0);
check("the record verifies", verifyCompare(record).ok);
check("the record is chained", readCompares().at(-1)?.id === record.id);

const byLabel = Object.fromEntries(record.arms.map((a) => [a.label, a]));
const off = byLabel["naive, no gate"];
const advisory = byLabel["naive, gate advisory"];
const enforced = byLabel["naive, gate enforced"];
const careful = byLabel["careful, no gate"];

check("the naive agent with no gate has critical violations", off.criticalViolations > 0, `${off.criticalViolations} in ${off.episodes}`);
check("every rate carries its n", record.arms.every((a) => a.axes.safety.n > 0 && a.axes.capability.n > 0), record.arms.map((a) => `${a.label}: safety n=${a.axes.safety.n}, capability n=${a.axes.capability.n}`).join("; "));
check("the enforced arm lowers the simulated wrongful amount", enforced.simulatedWrongfulAmount < off.simulatedWrongfulAmount, `${off.simulatedWrongfulAmount} → ${enforced.simulatedWrongfulAmount}`);
check("skipped-control is null in the enforced arm and rendered as impossible", enforced.skippedControl === null && enforced.skippedControlLabel.startsWith("Not possible"));
check("the advisory arm on a reference agent is marked as not measuring skip behaviour", advisory.measuresSkipBehaviour === false);
check("and the record says so in a note", record.notes.some((n) => n.includes("reference agent") && n.includes("measures nothing")));
check("the amounts are labelled simulated in the notes", record.notes.some((n) => n.includes("simulated")));

// The recommendation must not be an arm with a critical violation, whatever
// its other numbers say.
const rec = record.recommendation;
check("the recommendation names its rule", rec.rule.includes("no critical violation"));
if (rec.label) {
  check("the recommended arm has zero critical violations", byLabel[rec.label].criticalViolations === 0, `${rec.label}`);
  check("the reason states the numbers with n", /n=\d+/.test(rec.reason));
} else {
  check("no clean arm, so no recommendation, and the reason says why", rec.reason.includes("No arm is clean"));
}
check("the careful agent is the clean arm here", careful.criticalViolations === 0, `${careful.criticalViolations}`);

check("differences list the scenarios where arms disagree", record.differences.length > 0 && record.differences.every((d) => Object.keys(d.byArm).length === 4));

// Guards.
let threw = "";
try {
  await compareArms([{ target: referenceToolAgents.careful }], { pack });
} catch (e) {
  threw = (e as Error).message;
}
check("one arm is refused", threw.includes("at least two"));
threw = "";
try {
  await compareArms([{ label: "a", target: referenceToolAgents.careful }, { label: "a", target: referenceToolAgents.naive }], { pack });
} catch (e) {
  threw = (e as Error).message;
}
check("duplicate labels are refused", threw.includes("distinct"));

// Tamper.
const tampered = { ...record, arms: record.arms.map((a) => ({ ...a, criticalViolations: 0 })) };
check("zeroing the criticals breaks verification", !verifyCompare(tampered).ok);

console.log("");
console.log(formatCompare(record));
console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All Compare checks passed");
