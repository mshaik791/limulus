import { readFileSync } from "node:fs";
import { compilePolicy } from "./compile.ts";
import { CONTROL_TYPES, parsePolicyProfile, type PolicyProfile } from "./controls.ts";
import { parseScenario, toScenarioFile } from "../bench/scenario-file.ts";
import { isTaxonomyId } from "../bench/taxonomy.ts";
import { canonical } from "../record.ts";
import { runSuite } from "../sandbox/lab.ts";
import { referenceToolAgents } from "../sandbox/agents.ts";
import type { EpisodeGrade } from "../sandbox/score.ts";

// The compiler is only worth having if three things hold:
//   1. every compiled scenario is a valid, answerable scenario file;
//   2. a correct agent passes all of them with no critical violation, so a
//      failure on a compiled suite is the agent's, not the compiler's;
//   3. a careless agent fails the traps, so the suite discriminates.
// Plus determinism, because a suite that compiles differently tomorrow cannot
// be a regression baseline.
//
//   node src/policy/selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// ---- parsing ----------------------------------------------------------------
const exampleRaw = JSON.parse(readFileSync(new URL("../../policies/example.controls.json", import.meta.url), "utf8"));
const parsed = parsePolicyProfile(exampleRaw);
check("the example controls file parses", Boolean(parsed.profile), parsed.problems.map((p) => `${p.field}: ${p.detail}`).join("; "));
const profile = parsed.profile as PolicyProfile;
check("every supported control type is exercised by the example", Object.keys(CONTROL_TYPES).every((t) => profile.controls.some((c) => c.type === t)));

const bad = parsePolicyProfile({ name: "x", controls: [{ type: "required_approver", id: "a", name: "n" }] });
check("an unsupported-but-recognised type is refused by name", !bad.profile && bad.problems.some((p) => p.detail.includes("does not support yet")));
const typo = parsePolicyProfile({ name: "x", controls: [{ type: "spending_threshold", id: "a", name: "n", amount: 1, ammount: 2 }] });
check("a misspelt parameter is an error, not ignored", !typo.profile && typo.problems.some((p) => p.field.endsWith("ammount")));
const badId = parsePolicyProfile({ name: "x", controls: [{ type: "vendor_allowlist", id: "Bad Id", name: "n" }] });
check("a control id that cannot prefix a scenario id is refused", !badId.profile);
const dup = parsePolicyProfile({ name: "x", controls: [{ type: "vendor_allowlist", id: "a", name: "n" }, { type: "duplicate_payment", id: "a", name: "n" }] });
check("duplicate control ids are refused", !dup.profile);

// ---- compiling --------------------------------------------------------------
const asOf = new Date().toISOString().slice(0, 10);
const result = compilePolicy(profile, { asOf });
const expectedCount = profile.controls.reduce((n, c) => n + CONTROL_TYPES[c.type].cases, 0);
check("one scenario per documented case", result.scenarios.length === expectedCount, `${result.scenarios.length} of ${expectedCount}`);
check("every control compiles at least one pay case, so friction is measured", result.summary.every((s) => s.controls >= 1));
check("every control compiles at least one trap", result.summary.every((s) => s.traps >= 1));

const again = compilePolicy(profile, { asOf });
check("compiling twice gives byte-identical output", JSON.stringify(result) === JSON.stringify(again));

const ids = result.scenarios.map((s) => s.id);
check("scenario ids are unique", new Set(ids).size === ids.length);
check("every scenario names the control and case it came from", result.scenarios.every((s) => s.compiledFrom?.controlId && s.compiledFrom.case && s.compiledFrom.policyId === result.policyId));
const badTags = result.scenarios.flatMap((s) => (s.taxonomy ?? []).filter((t) => !isTaxonomyId(t)));
check("every taxonomy tag exists in the taxonomy", badTags.length === 0, badTags.join(", "));

// Round trip through the file format, with the same validator the CLI and the
// gate use. An error here means a compiled suite would be refused at the gate.
const fileProblems = result.scenarios.flatMap((s) => {
  const { scenario, problems } = parseScenario(JSON.parse(toScenarioFile(s)), `${s.id}.scenario.json`);
  return [
    ...problems.filter((p) => p.severity === "error").map((p) => `${p.file} ${p.field}: ${p.detail}`),
    ...(scenario && canonical(scenario) !== canonical(s) ? [`${s.id}: did not round-trip`] : []),
  ];
});
check("every compiled scenario is a valid, answerable scenario file that round-trips", fileProblems.length === 0, fileProblems.slice(0, 3).join(" | "));
// The single-over-ceiling case sets the daily ceiling below the per-payment
// limit on purpose: that is the shape in which one payment can clear the day's
// cap while staying inside its own. The validator flags that shape as probably
// unintended, which is right for a hand-written file and wrong here.
const intended = (file: string, field: string) => file.endsWith("single-over-ceiling") && field === "authorization.limitPerDay";
const warnings = result.scenarios.flatMap((s) =>
  parseScenario(JSON.parse(toScenarioFile(s)), s.id).problems.filter((p) => p.severity === "warning" && !intended(p.file, p.field)),
);
check("no compiled scenario draws an unintended validator warning", warnings.length === 0, warnings.slice(0, 3).map((w) => `${w.file} ${w.field}: ${w.detail}`).join(" | "));

// ---- does a correct agent pass, and a careless one fail? --------------------
const careful = await runSuite(referenceToolAgents.careful, { pack: result.scenarios, trials: 1, suite: { id: "compiled-selftest" } });
const cGrades = careful.run.grades as EpisodeGrade[];
const cFailing = cGrades.filter((g) => g.effective !== g.expected || g.criticalCount > 0);
check(
  "the careful reference agent passes every compiled scenario",
  cFailing.length === 0,
  cFailing.slice(0, 4).map((g) => `${g.scenarioId}: expected ${g.expected}, did ${g.effective}${g.violations.length ? ` [${g.violations.map((v) => v.code).join(",")}]` : ""}`).join(" | "),
);
check("and with no critical violation", cGrades.every((g) => g.criticalCount === 0));

const naive = await runSuite(referenceToolAgents.naive, { pack: result.scenarios, trials: 1, suite: { id: "compiled-selftest" } });
const nGrades = naive.run.grades as EpisodeGrade[];
const traps = result.scenarios.filter((s) => s.expected !== "proceed").map((s) => s.id);
const nCaught = nGrades.filter((g) => traps.includes(g.scenarioId) && g.criticalCount > 0).length;
check("the naive reference agent is caught by most traps", nCaught >= Math.ceil(traps.length * 0.8), `${nCaught} of ${traps.length}`);
const pays = result.scenarios.filter((s) => s.expected === "proceed").map((s) => s.id);
const nPays = nGrades.filter((g) => pays.includes(g.scenarioId) && g.effective === "proceed").length;
check("the pay cases are payable: the naive agent completes them", nPays === pays.length, `${nPays} of ${pays.length}`);

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All policy compiler checks passed");
