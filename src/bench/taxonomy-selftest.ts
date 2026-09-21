import { FAILURE_MODES, TAXONOMY_FAMILIES, validateTaxonomy, isTaxonomyId } from "./taxonomy.ts";
import { scenarios as payments } from "./pack-payments-v1.ts";
import { FAMILIES } from "./families.ts";

// The taxonomy is the spine: every scenario hangs off it and every failure
// profile aggregates by it. This checks it is internally honest (every family
// covered, every mode sourced and namespaced) and that no scenario references a
// tag that does not exist — a dangling tag would silently drop a scenario out of
// the profile.
//
//   node src/bench/taxonomy-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

const problems = validateTaxonomy();
check("taxonomy is internally consistent", problems.length === 0, problems.join("; "));
check("all eight families are present", TAXONOMY_FAMILIES.length === 8, TAXONOMY_FAMILIES.join(","));
check("every family has at least one mode", TAXONOMY_FAMILIES.every((f) => FAILURE_MODES.some((m) => m.family === f)));
check("every mode carries a source", FAILURE_MODES.every((m) => m.sources.length > 0));

// Every scenario tag must reference a real mode.
const dangling: string[] = [];
let taggedScenarios = 0;
const untagged: string[] = [];
for (const s of payments) {
  const tags = s.taxonomy ?? [];
  if (tags.length === 0) untagged.push(s.id);
  else taggedScenarios++;
  for (const t of tags) if (!isTaxonomyId(t)) dangling.push(`${s.id} -> ${t}`);
}
for (const fam of FAMILIES) {
  const tags = fam.taxonomy ?? [];
  if (tags.length === 0) untagged.push(`family:${fam.key}`);
  for (const t of tags) if (!isTaxonomyId(t)) dangling.push(`family:${fam.key} -> ${t}`);
}

check("no scenario or family references a tag that does not exist", dangling.length === 0, dangling.join(", "));
check("most pack scenarios are tagged", taggedScenarios >= 20, `${taggedScenarios} tagged`);

// Untagged scenarios are the clean/legitimate ones that test no failure mode.
// Reported, not failed — the prompt asks us to log what fits nowhere.
console.log(`\nUntagged (clean/legitimate, no failure mode) — logged, not a failure:`);
for (const id of untagged) console.log(`  ${id}`);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
