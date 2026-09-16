import { decide, summarize } from "./decide.ts";
import { verifyChain } from "./record.ts";
import { scenarios } from "./scenarios.ts";

// Run: node src/demo.ts [scenario]
// Scenarios: clean, poisoned, altered, overlimit. With no argument, runs all.

const requested = process.argv[2];
const selected = requested ? [requested] : Object.keys(scenarios);

for (const key of selected) {
  const scenario = scenarios[key];
  if (!scenario) {
    console.error(`Unknown scenario "${key}". Options: ${Object.keys(scenarios).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${scenario.title}`);
  console.log("-".repeat(scenario.title.length));
  const record = decide(scenario.request);
  console.log(summarize(record));
  console.log(`  record ${record.hash.slice(0, 12)} signed, previous ${record.prevHash?.slice(0, 12) ?? "none"}`);
}

const verification = verifyChain();
console.log(
  `\nChain: ${verification.count} record(s), ${verification.ok ? "verified" : "PROBLEMS FOUND"}`,
);
for (const problem of verification.problems) console.log(`  ${problem.id}: ${problem.problem}`);
