import { chainFile, publicKeyPem, verifyChain } from "./record.ts";

// Run: node src/verify-cli.ts
// Recomputes every hash, checks every signature, and confirms each record
// points at the one before it.

const result = verifyChain();

console.log(`Chain file: ${chainFile}`);
console.log(`Records:    ${result.count}`);
console.log(`Status:     ${result.ok ? "verified" : "PROBLEMS FOUND"}`);
for (const problem of result.problems) console.log(`  ${problem.id}: ${problem.problem}`);
console.log(`\nPublic key:\n${publicKeyPem}`);

process.exit(result.ok ? 0 : 1);
