import { reconcile } from "./reconcile.ts";

// Ask the bank what actually happened and compare it with what we decided.
//
//   node --env-file=.env src/rails/reconcile-cli.ts

const result = await reconcile(Number(process.argv[2] ?? 100));

if (result.mode === "simulated") {
  console.log("No INCREASE_API_KEY set, so there is no rail to ask. Reconciliation needs the real thing.");
  process.exit(0);
}

console.log(`Checked ${result.checked} transfer(s) at ${result.mode}.\n`);

if (result.drift.length === 0) {
  console.log("Every transfer at the bank matches the decision behind it.");
  process.exit(0);
}

const worst = result.drift.filter((d) => d.code === "unauthorized");
if (worst.length > 0) {
  console.log(`${worst.length} payment(s) moved although we did not release them:\n`);
  for (const d of worst) {
    console.log(`  ${d.transferId}`);
    console.log(`     ${d.status} at the bank · decision ${d.decisionId} ${d.decided} it · USD ${d.amount.toLocaleString()}`);
  }
  console.log("");
}

const rest = result.drift.filter((d) => d.code !== "unauthorized");
for (const d of rest) {
  console.log(`  ${d.code.padEnd(22)} ${d.transferId}  ${d.detail}`);
}

console.log(`\n${result.drift.length} finding(s). Settlements seen here are recorded against their decisions.`);
process.exit(worst.length > 0 ? 1 : 0);
