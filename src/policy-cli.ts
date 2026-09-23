import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilePolicy, formatSummary } from "./policy/compile.ts";
import { CONTROL_TYPES, parsePolicyProfile, policyProfileId } from "./policy/controls.ts";
import { toScenarioFile } from "./bench/scenario-file.ts";

// Compile a customer's controls into a runnable scenario suite.
//
//   node src/policy-cli.ts types
//   node src/policy-cli.ts validate policies/example.controls.json
//   node src/policy-cli.ts compile policies/example.controls.json [--out dir] [--as-of 2026-09-23]
//
// The output is a directory of *.scenario.json files, the same shape as
// scenarios/, so the compiled suite runs through every existing path:
//
//   node src/lab-cli.ts run careful 3 --scenarios build/compiled/<policyId>
//   node src/bench/ci-gate.ts --scenarios build/compiled/<policyId> --agent http://...

const [command, ...args] = process.argv.slice(2);

const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};

function load(path: string | undefined) {
  if (!path || !existsSync(path)) {
    console.error(`\n  Need a controls file. Example: policies/example.controls.json\n`);
    process.exit(2);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`\n  ${path} is not valid JSON: ${(e as Error).message}\n`);
    process.exit(1);
  }
  const { profile, problems } = parsePolicyProfile(raw);
  if (!profile) {
    console.error(`\n  ${path}: ${problems.length} problem(s). Nothing was compiled.\n`);
    for (const p of problems) console.error(`    ${p.field || "(root)"}: ${p.detail}`);
    console.error("");
    process.exit(1);
  }
  return profile;
}

switch (command) {
  case "types": {
    console.log("");
    for (const [type, info] of Object.entries(CONTROL_TYPES)) {
      console.log(`  ${type.padEnd(20)} ${info.cases} cases   ${info.summary}`);
      if (info.parameters.length) console.log(`  ${"".padEnd(20)} parameters: ${info.parameters.join(", ")}`);
    }
    console.log("");
    break;
  }
  case "validate": {
    const profile = load(args[0]);
    console.log(`\n  ok  ${profile.name}  ${policyProfileId(profile)}  ${profile.controls.length} control(s)\n`);
    break;
  }
  case "compile": {
    const profile = load(args[0]);
    const result = compilePolicy(profile, { asOf: flag("--as-of") });
    const outDir = flag("--out", join("build", "compiled", result.policyId))!;
    mkdirSync(outDir, { recursive: true });
    for (const s of result.scenarios) writeFileSync(join(outDir, `${s.id}.scenario.json`), toScenarioFile(s));
    console.log("");
    console.log(formatSummary(result));
    console.log("");
    console.log(`written    ${outDir}/`);
    console.log(`run them   node src/lab-cli.ts run careful 3 --scenarios ${outDir}`);
    console.log(`gate them  node src/bench/ci-gate.ts --scenarios ${outDir} --agent <url> --update-baseline`);
    console.log("");
    break;
  }
  default: {
    console.log(`
  node src/policy-cli.ts types
  node src/policy-cli.ts validate <controls.json>
  node src/policy-cli.ts compile <controls.json> [--out dir] [--as-of YYYY-MM-DD]
`);
    process.exit(command ? 2 : 0);
  }
}
