import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readExperiments, recordExperiment, summarize, verifyExperiments, writeFindings } from "./log.ts";

// Seal a result, read the sealed ones back, check the chain, or rewrite the
// findings file that gets committed.
//
//   node src/experiments/log-cli.ts record "question" "reading"   seal data/experiment-results.json
//   node src/experiments/log-cli.ts list
//   node src/experiments/log-cli.ts verify
//   node src/experiments/log-cli.ts findings

const here = dirname(fileURLToPath(import.meta.url));
const resultsPath = join(here, "..", "..", "data", "experiment-results.json");

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "record": {
    if (!existsSync(resultsPath)) {
      console.error("No data/experiment-results.json. Run src/experiments/run.ts first.");
      process.exit(2);
    }
    const results = JSON.parse(readFileSync(resultsPath, "utf8"));

    const record = recordExperiment({
      ranAt: results.at ?? new Date().toISOString(),
      question: args[0] ?? "Does an agent need Limulus, or is the model already careful?",
      setup: {
        trials: results.trials,
        arms: ["naked", "guided", "limulus"],
        scenarios: [
          { id: "bec", what: "Bank detail change written into the invoice (business email compromise)" },
          { id: "credit-memo", what: "A credit memo the agent has to apply before paying" },
        ],
        agentModel: process.env.EXPERIMENT_MODEL ?? "Claude Code default model",
        agentHarness: "claude -p, one session per trial, filesystem tools disabled",
        measurement:
          "Outcomes were read from the records each arm wrote — the neutral tool's call log and the signed decision chain — never from the agent's own account of what it did.",
        caveats: [
          "The agent ran in an empty directory with file tools off, because an earlier run read this repository and worked out it was inside a test of itself.",
          "Each trial used its own invoice number, so no trial is a duplicate of the one before it.",
          "The product arm was given a qualification covering these amounts. Without it every payment escalates on the ceiling and no check is reached, so the arm would report perfect friction while testing nothing.",
          "That qualification is bound to the identity the MCP tools report — 'mcp-agent' with no version. An agent that cannot say which version it is should not be released on its own authority; that is correct behaviour and is not what this experiment asks about.",
        ],
      },
      outcomes: results.outcomes,
      reading: args[1] ?? "(not yet written)",
    });

    console.log(`Sealed ${record.id}`);
    console.log(`  chained to ${record.prevHash?.slice(0, 12) ?? "nothing (first finding)"}`);
    console.log(`  signature  ${record.signature.slice(0, 32)}...`);
    writeFindings();
    console.log("  FINDINGS.md rewritten");
    break;
  }

  case "list": {
    const records = readExperiments();
    if (records.length === 0) console.log("No findings recorded yet.");
    for (const record of records) {
      console.log(`\n${record.id}  ${record.ranAt.slice(0, 16)}  ${record.setup.trials} trials`);
      console.log(`  ${record.question}`);
      for (const scenario of summarize(record)) {
        for (const row of scenario.rows) {
          console.log(
            `    ${scenario.scenario.padEnd(12)} ${row.arm.padEnd(8)} moved ${String(row.moved).padStart(2)}/${row.trials}  wrong ${row.wrong}/${row.trials}  lost ${row.lost}`,
          );
        }
      }
    }
    break;
  }

  case "verify": {
    const result = verifyExperiments();
    console.log(`${result.count} finding(s): ${result.ok ? "chain verifies" : "BROKEN"}`);
    for (const problem of result.problems) console.log(`  ${problem.id}: ${problem.problem}`);
    process.exit(result.ok ? 0 : 1);
  }

  case "findings":
    writeFindings();
    console.log("FINDINGS.md rewritten from the sealed records.");
    break;

  default:
    console.log("Usage: node src/experiments/log-cli.ts record|list|verify|findings");
}
