import { recordIntent, verifyIntent, verifyIntentChain, readIntents, readIntentsForAgent, intentAgents, hashDocuments } from "./intent.ts";

// Signed intent records from the command line.
//
//   node src/intent-cli.ts record            append a demo intent
//   node src/intent-cli.ts list              recent intents
//   node src/intent-cli.ts verify <id>       verify one record
//   node src/intent-cli.ts verify-chain [agentId]   verify an agent's chain (all agents if omitted)

const [command, arg] = process.argv.slice(2);

switch (command) {
  case "record": {
    const r = recordIntent({
      agentId: arg ?? "demo-agent",
      configHash: "cfg-demo",
      runId: `run-${Date.now().toString().slice(-6)}`,
      declared: { invoiceId: "INV-DEMO", payeeName: "Northline Steel", payeeAccountLast4: "2210", amount: 64_000, currency: "USD", rail: "ach" },
      documentHashes: hashDocuments([{ name: "INV-DEMO.pdf", text: "Northline Steel. Total USD 64,000.00. Remit to account on file." }]),
      mandateId: "mnd-demo",
      model: { name: "reference-careful-tools", version: "0.3.1", source: "configured" },
    });
    console.log(`recorded ${r.id} for ${r.agentId} (prevHash ${r.prevHash ? r.prevHash.slice(0, 12) : "none"})`);
    console.log(`  proves: this declaration existed in this form at ${r.createdAt} and is unaltered.`);
    console.log(`  does not prove: that the declaration was correct or honest.`);
    break;
  }
  case "list": {
    const all = readIntents().slice(-20);
    console.log(`${readIntents().length} intents across ${intentAgents().length} agent(s). Most recent:`);
    for (const r of all) console.log(`  ${r.id}  ${r.agentId.padEnd(24)} ${r.declared.invoiceId.padEnd(12)} ${r.declared.amount.toLocaleString()} ${r.declared.currency}`);
    break;
  }
  case "verify": {
    const record = readIntents().find((r) => r.id === arg);
    if (!record) { console.error(`No intent ${JSON.stringify(arg)}.`); process.exit(1); }
    const v = verifyIntent(record);
    console.log(v.ok ? `ok  ${record.id} verifies` : `FAIL  ${record.id}: ${v.problems.join("; ")}`);
    process.exit(v.ok ? 0 : 1);
  }
  case "verify-chain": {
    const agents = arg ? [arg] : intentAgents();
    if (agents.length === 0) { console.log("No intents recorded yet. Try: node src/intent-cli.ts record"); break; }
    let bad = 0;
    for (const a of agents) {
      const v = verifyIntentChain(a);
      console.log(`${v.ok ? "ok  " : "FAIL"}  ${a.padEnd(28)} ${v.count} record(s)${v.ok ? "" : `  — ${v.problems.map((p) => p.problem).join("; ")}`}`);
      if (!v.ok) bad++;
    }
    process.exit(bad === 0 ? 0 : 1);
  }
  default:
    console.log("commands: record | list | verify <id> | verify-chain [agentId]");
}
