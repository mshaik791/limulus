import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { FAMILIES, rngFrom } from "./families.ts";
import { heldOutPath, leakCheck, openPool, seedFile, type PooledScenario } from "./pools.ts";

// Generates the private half of the Lab.
//
//   node src/bench/generate-held-out.ts                  new cohort
//   node src/bench/generate-held-out.ts --per 5          instances per family
//   node src/bench/generate-held-out.ts --cohort c2      name it
//
// Output goes to data/held-out/, which is gitignored, because this repository
// is public and a held-out set anyone can read is not held out. The families
// stay in the repo — the threat model is meant to be public. Only the
// instances are secret.
//
// The seed is written once and reused, so a cohort can be regenerated exactly
// if it is ever lost, but cannot be guessed from anything published.

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const perFamily = Number(arg("--per", "3"));
const cohort = arg("--cohort", `c${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`)!;

mkdirSync(heldOutPath, { recursive: true });

// One seed per machine, kept out of git alongside the instances.
let seed: string;
if (existsSync(seedFile)) {
  seed = JSON.parse(readFileSync(seedFile, "utf8")).seed;
} else {
  seed = randomBytes(24).toString("hex");
  writeFileSync(seedFile, `${JSON.stringify({ seed, createdAt: new Date().toISOString() }, null, 2)}\n`);
  console.log("  wrote a new seed. Back it up somewhere private; it is not in git.");
}

const built: PooledScenario[] = [];
for (const family of FAMILIES) {
  for (let n = 1; n <= perFamily; n++) {
    // Seed per instance, so adding a family or an instance never disturbs the
    // ones already generated and scored against.
    const rng = rngFrom(`${seed}:${cohort}:${family.key}:${n}`);
    const scenario = family.build(rng, n);
    built.push({
      ...scenario,
      id: `${scenario.id}-${cohort}`,
      pool: "held-out",
      cohort,
      category: family.category,
      severity: family.severity,
      expected: family.expected,
      source: family.source,
    });
  }
}

// ---- refuse to write a cohort that leaks -------------------------------
const open = await openPool();
const leak = leakCheck(open, built);
if (!leak.ok) {
  console.error("\n  Refusing to write: this cohort overlaps the open pool.");
  if (leak.identicalContent.length) console.error("   identical content:", leak.identicalContent.join(", "));
  if (leak.sharedIds.length) console.error("   shared ids:", leak.sharedIds.join(", "));
  process.exit(1);
}

for (const scenario of built) {
  writeFileSync(join(heldOutPath, `${scenario.id}.scenario.json`), `${JSON.stringify(scenario, null, 2)}\n`);
}

// ---- report -------------------------------------------------------------
console.log(`\n  cohort ${cohort}: ${built.length} held-out scenarios in ${FAMILIES.length} families\n`);
const byFamily = new Map<string, number>();
for (const f of FAMILIES) byFamily.set(f.key, built.filter((s) => s.id.startsWith(`held-${f.key}-`)).length);
for (const f of FAMILIES) {
  console.log(`    ${f.key.padEnd(22)} ${String(byFamily.get(f.key)).padStart(2)}  ${f.expected.padEnd(8)} ${f.severity}`);
}
console.log(`\n  open pool:     ${open.length} scenarios (public, iterate freely)`);
console.log(`  held-out pool: ${built.length} scenarios (private, qualification only)`);
console.log(`  leak check:    no shared ids, no identical content`);
console.log(`\n  written to ${heldOutPath}  (gitignored)`);
console.log(`  seed at    ${seedFile}  (gitignored — back this up)\n`);
