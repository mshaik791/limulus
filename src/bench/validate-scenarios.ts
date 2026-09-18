import { existsSync, statSync } from "node:fs";
import { loadScenarioDir, loadScenarioFile, type Problem } from "./scenario-file.ts";

// Validates scenario files. This is what runs in a customer's CI before their
// suite is allowed to run, and what they run locally while authoring.
//
//   node src/bench/validate-scenarios.ts scenarios
//   node src/bench/validate-scenarios.ts scenarios/one.scenario.json
//   node src/bench/validate-scenarios.ts scenarios --strict     warnings fail too
//
// Exit codes matter, because CI reads them:
//   0  every scenario is valid
//   1  at least one scenario is invalid (or, with --strict, has a warning)
//   2  the path does not exist — a misconfigured job, not a bad scenario
//
// That last distinction is deliberate. A CI step that silently passes because it
// was pointed at the wrong directory is worse than one that fails.

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const strict = process.argv.includes("--strict");
const target = args[0] ?? "scenarios";

if (!existsSync(target)) {
  console.error(`\n  No such path: ${target}`);
  console.error(`  Point this at a directory of *.scenario.json files, or at one such file.\n`);
  process.exit(2);
}

const { scenarios, problems } =
  statSync(target).isDirectory()
    ? loadScenarioDir(target)
    : (() => {
        const r = loadScenarioFile(target);
        return { scenarios: r.scenario ? [r.scenario] : [], problems: r.problems };
      })();

const errors = problems.filter((p) => p.severity === "error");
const warnings = problems.filter((p) => p.severity === "warning");

console.log(`\n  ${target}: ${scenarios.length} valid scenario(s), ${errors.length} error(s), ${warnings.length} warning(s)\n`);

function render(group: Problem[], heading: string) {
  if (group.length === 0) return;
  console.log(`  ${heading}`);
  const byFile = new Map<string, Problem[]>();
  for (const p of group) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
  for (const [file, list] of byFile) {
    console.log(`    ${file || "(input)"}`);
    for (const p of list) {
      console.log(`      ${p.field || "(root)"}`);
      // Wrap the detail so a long explanation stays readable in a CI log.
      const words = p.detail.split(" ");
      let line = "";
      for (const w of words) {
        if ((line + w).length > 86) {
          console.log(`        ${line.trim()}`);
          line = "";
        }
        line += `${w} `;
      }
      if (line.trim()) console.log(`        ${line.trim()}`);
    }
  }
  console.log("");
}

render(errors, `INVALID — these scenarios will not be run`);
render(warnings, `WORTH A LOOK — valid, but probably not measuring what was intended`);

if (scenarios.length > 0) {
  console.log("  loaded");
  const width = Math.max(...scenarios.map((s) => s.id.length));
  for (const s of scenarios) {
    const rails = (s.railEvents ?? []).length;
    console.log(
      `    ${s.id.padEnd(width)}  ${s.expected.padEnd(7)} ${s.severity.padEnd(8)} ${s.category.padEnd(12)}` +
        `${s.documents.length} doc(s)${rails ? `, ${rails} rail event(s)` : ""}`,
    );
  }
  console.log("");
}

if (errors.length > 0) {
  console.log(`  ${errors.length} scenario problem(s) must be fixed before these can be scored.\n`);
  process.exit(1);
}
if (strict && warnings.length > 0) {
  console.log(`  --strict: treating ${warnings.length} warning(s) as failure.\n`);
  process.exit(1);
}
console.log(`  All ${scenarios.length} scenario(s) valid.\n`);
