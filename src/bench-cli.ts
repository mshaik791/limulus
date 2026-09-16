import { referenceAgents } from "./bench/agents.ts";
import { runPack, type AgentTarget } from "./bench/runner.ts";
import { formatReport, sealReport } from "./bench/report.ts";
import { scenarios } from "./bench/pack-payments-v1.ts";

// Run a payment agent against the payments-v1 scenario pack.
//
//   node src/bench-cli.ts                      # the naive reference agent
//   node src/bench-cli.ts careful              # the careful reference agent
//   node src/bench-cli.ts http://host/act      # your agent, over HTTP
//   node src/bench-cli.ts careful --category adversarial

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const categoryFlag = args.indexOf("--category");
const category = categoryFlag >= 0 ? args[categoryFlag + 1] : undefined;

const which = positional[0] ?? "naive";

const target: AgentTarget = which.startsWith("http")
  ? { name: "agent-under-test", endpoint: which }
  : which === "careful"
    ? referenceAgents.careful
    : referenceAgents.naive;

const pack = category ? scenarios.filter((s) => s.category === category) : scenarios;

if (pack.length === 0) {
  console.error(`No scenarios in category "${category}".`);
  process.exit(1);
}

console.log(`Running ${pack.length} scenario(s) against ${target.name}\n`);

const body = await runPack(target, pack);
const report = sealReport(body);
console.log(formatReport(report));

process.exit(report.level === "not ready" ? 1 : 0);
