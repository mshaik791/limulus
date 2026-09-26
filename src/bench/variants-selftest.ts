import "../selftest-env.ts";
import { generateVariants, fingerprint, abaChecksumValid, makeValidAba, breakAba, OPERATORS } from "./variants.ts";
import { rngFrom } from "./families.ts";
import { scenarios as payments } from "./pack-payments-v1.ts";
import { runSuite } from "../sandbox/lab.ts";
import { referenceToolAgents } from "../sandbox/agents.ts";
import { toScenarioFile, parseScenario } from "./scenario-file.ts";

// The generator must be reproducible to the byte, must never lose a variant's
// provenance, must pair every trap with a pay control, and must produce
// scenarios the Lab can actually grade. All deterministic; no LLM, no key.
//
//   node src/bench/variants-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// A clean, approved invoice is the right base: operators inject one trap each.
const seed = payments.find((s) => s.id === "man-003");
check("found a clean seed (man-003)", !!seed, seed ? "" : "missing");
if (!seed) { console.log("\n1 FAILED"); process.exit(1); }

// ---- ABA checksum (the explicit requirement) ----------------------------
check("a real routing number passes the ABA checksum", abaChecksumValid("021000021"));
check("a bad routing number fails the ABA checksum", !abaChecksumValid("123456789"));
const rng = rngFrom("aba-test");
const valid = makeValidAba(rng);
check("makeValidAba produces a valid routing number", abaChecksumValid(valid), valid);
check("breakAba produces an invalid one", !abaChecksumValid(breakAba(valid, rng)));

// ---- determinism --------------------------------------------------------
const a = generateVariants(seed, { count: 2 });
const b = generateVariants(seed, { count: 2 });
check("generation is deterministic (same ids)", JSON.stringify(a.map((s) => s.id)) === JSON.stringify(b.map((s) => s.id)));
check("generation is deterministic (same fingerprints)", a.map(fingerprint).join() === b.map(fingerprint).join());
check("it produced a batch of variants", a.length >= OPERATORS.length, `${a.length} variants`);

// ---- provenance ---------------------------------------------------------
check("every variant records its seed", a.every((s) => s.variantOf === "man-003"));
check("every variant records its operators", a.every((s) => (s.operators?.length ?? 0) > 0));
check("every variant records a deterministic seed string", a.every((s) => typeof s.variantSeed === "string" && s.variantSeed!.length > 0));
check("every variant is labelled a variant in its title", a.every((s) => s.title.includes("variant:")));

// ---- dedup --------------------------------------------------------------
const fps = a.map(fingerprint);
check("no two variants share a fingerprint", new Set(fps).size === fps.length, `${fps.length} variants, ${new Set(fps).size} unique`);

// ---- twins: every trap operator has a pay control -----------------------
const flipOps = OPERATORS.filter((o) => o.flips).map((o) => o.id);
const missingTwin = flipOps.filter(
  (opId) => !a.some((s) => s.operators?.includes(`${opId}:control`) && s.expected === "proceed"),
);
check("every trap operator has a matching pay control", missingTwin.length === 0, missingTwin.join(", "));
check("controls are the pay case", a.filter((s) => s.operators?.[0]?.endsWith(":control")).every((s) => s.expected === "proceed"));

// ---- round-trip: variants survive the strict file validator -------------
check("variant ids are validator-safe (no dots)", a.every((s) => /^[a-z0-9][a-z0-9-]*$/.test(s.id)));
let rtErrors = 0;
let rtProvenance = true;
for (const v of a.slice(0, 10)) {
  const { scenario, problems } = parseScenario(JSON.parse(toScenarioFile(v)), v.id);
  if (problems.some((p) => p.severity === "error")) rtErrors++;
  if (!scenario || scenario.variantOf !== "man-003" || JSON.stringify(scenario.operators) !== JSON.stringify(v.operators)) rtProvenance = false;
}
check("variants round-trip through the strict file validator", rtErrors === 0, `${rtErrors} had errors`);
check("provenance survives the round-trip", rtProvenance);

// ---- gradeability: the Lab can run and grade generated variants ----------
const sample = a.slice(0, 6);
const { run } = await runSuite(referenceToolAgents.careful, { pack: sample, suite: { id: "variant-selftest" }, trials: 1, allowRetake: true });
check("the Lab graded the generated variants without crashing", (run.grades as unknown[]).length === sample.length, `${(run.grades as unknown[]).length}/${sample.length} graded`);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
