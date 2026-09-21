import { profileForConfig, compareProfiles, agentConfigs } from "./failure-profile.ts";

// The per-agent failure profile from the command line.
//
//   node src/failure-profile-cli.ts configs                 agent configs with Lab runs
//   node src/failure-profile-cli.ts profile <name> [version]
//   node src/failure-profile-cli.ts compare <name> <vA> <vB>

const [command, name, a, b] = process.argv.slice(2);

switch (command) {
  case "configs": {
    const configs = agentConfigs();
    console.log(`${configs.length} agent config(s) with Lab runs:`);
    for (const c of configs) console.log(`  ${c.name} v${c.version}`);
    break;
  }
  case "profile": {
    const configs = agentConfigs();
    const version = a ?? configs.filter((c) => c.name === name).map((c) => c.version).pop();
    if (!name || !version) { console.error(`profile needs <name> [version]. Known: ${configs.map((c) => `${c.name} v${c.version}`).join(", ")}`); process.exit(2); }
    const p = profileForConfig(name, version);
    console.log(`Failure profile  ${p.config.name} v${p.config.version}`);
    console.log(`  ${p.runIds.length} run(s), ${p.totalEpisodes} graded episode(s)\n`);
    if (p.findings.length === 0) console.log("  No failing taxonomy node with data. Either clean, or not enough trials.");
    for (const f of p.findings) console.log(`  - ${f}`);
    break;
  }
  case "compare": {
    if (!name || !a || !b) { console.error("compare needs <name> <vA> <vB>"); process.exit(2); }
    const diffs = compareProfiles(name, a, b);
    console.log(`Compare ${name}: v${a} -> v${b}  (${diffs.length} node(s) changed)`);
    for (const d of diffs) console.log(`  ${d.delta > 0 ? "WORSE" : "better"}  ${d.node.padEnd(28)} ${Math.round(d.rateA * 100)}% -> ${Math.round(d.rateB * 100)}%`);
    break;
  }
  default:
    console.log("commands: configs | profile <name> [version] | compare <name> <vA> <vB>");
}
