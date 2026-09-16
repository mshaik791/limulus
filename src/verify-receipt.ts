import { readFileSync } from "node:fs";
import { verifyReceipt } from "./receipt.ts";
import type { Receipt } from "./receipt.ts";

// Verify a receipt from a file, without contacting the service that issued it.
//
//   node src/verify-receipt.ts receipt.json

const path = process.argv[2];
if (!path) {
  console.error("Usage: node src/verify-receipt.ts <receipt.json>");
  process.exit(2);
}

const receipt = JSON.parse(readFileSync(path, "utf8")) as Receipt;
const result = verifyReceipt(receipt);

console.log(`Receipt ${receipt.receiptId ?? "(no id)"}`);
console.log(`Decision ${receipt.decision?.outcome ?? "?"} on ${receipt.decision?.at ?? "?"}`);
if (receipt.outcome) console.log(`Outcome  ${receipt.outcome.status}`);
console.log("");

for (const check of result.checks) {
  console.log(`${check.ok ? "ok  " : "FAIL"}  ${check.name}`);
  if (!check.ok) console.log(`      ${check.detail}`);
}

console.log(`\n${result.valid ? "VERIFIED" : "NOT VALID"}`);
process.exit(result.valid ? 0 : 1);
