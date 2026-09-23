import { ingestEvent, computeMetrics, generateCandidates, readCandidates, approveCandidate, rejectCandidate, readEvents } from "./monitor.ts";

// Monitor from the command line. Every one of these has an API equivalent.
//
//   node src/monitor-cli.ts ingest-demo [org]     append a demo transposed-account event
//   node src/monitor-cli.ts scan                  turn failure events into candidates
//   node src/monitor-cli.ts metrics               grouped metrics with n
//   node src/monitor-cli.ts candidates            the review queue
//   node src/monitor-cli.ts approve <id>          candidate -> private suite
//   node src/monitor-cli.ts reject <id>

const [command, arg] = process.argv.slice(2);

switch (command) {
  case "ingest-demo": {
    const org = arg ?? "demo-org";
    const e = ingestEvent({
      type: "payment_proposed", agentId: "demo-agent", configHash: "cfg-demo", runId: `sess-${Date.now().toString().slice(-5)}`, org,
      payload: { proposed: { payeeName: "Globex Customer Corp", payeeAccountLast4: "8482", amount: 128_500, invoiceId: "CUST-INV-777" }, recordAccountLast4: "8842" },
    });
    console.log(`ingested ${e.id} (payment_proposed, transposed account) for ${org}`);
    console.log(`  run 'scan' to turn failure events into review candidates.`);
    break;
  }
  case "scan": {
    const { created, deduped } = generateCandidates();
    console.log(`scanned ${readEvents().length} events -> ${created} new candidate(s), ${deduped} deduped into existing ones.`);
    break;
  }
  case "metrics": {
    const metrics = computeMetrics();
    for (const [group, entries] of Object.entries(metrics)) {
      console.log(`\n${group}`);
      for (const [name, mx] of Object.entries(entries)) console.log(`  ${name.padEnd(22)} ${mx.value}/${mx.of}  ${mx.note}`);
    }
    break;
  }
  case "candidates": {
    const list = readCandidates();
    console.log(`${list.length} candidate(s):`);
    for (const c of list) console.log(`  ${c.status.padEnd(8)} ${c.id}  ${c.org.padEnd(16)} ${c.taxonomyNode.padEnd(28)} x${c.count}  "${c.preservedProperty}"`);
    break;
  }
  case "approve": {
    const r = approveCandidate(arg ?? "");
    console.log(r.ok ? `approved ${arg} -> ${r.path}` : `could not approve: ${r.problem}`);
    process.exit(r.ok ? 0 : 1);
  }
  case "reject": {
    const ok = rejectCandidate(arg ?? "");
    console.log(ok ? `rejected ${arg}` : `could not reject ${arg} (not found or not pending)`);
    process.exit(ok ? 0 : 1);
  }
  default:
    console.log("commands: ingest-demo [org] | scan | metrics | candidates | approve <id> | reject <id>");
}
