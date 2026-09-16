import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sign as edSign, createPrivateKey, createPublicKey, verify as edVerify } from "node:crypto";
import { canonical, sha256, publicKeyPem } from "../record.ts";
import type { ReadinessReport } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "data");
const reportsPath = join(dataDir, "reports.jsonl");
const keyPath = join(dataDir, "signing-key.json");

function privateKey() {
  const material = JSON.parse(readFileSync(keyPath, "utf8"));
  return createPrivateKey(material.privateKey);
}

export function readReports(): ReadinessReport[] {
  if (!existsSync(reportsPath)) return [];
  return readFileSync(reportsPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ReadinessReport);
}

/**
 * Seals a readiness report: hashes it, signs the hash, and links it to the
 * previous report. A customer can hand the report to their own customer, and
 * anyone can verify it without us.
 */
export function sealReport(
  body: Omit<ReadinessReport, "hash" | "signature" | "publicKey" | "prevHash">,
): ReadinessReport {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const previous = readReports().at(-1) ?? null;
  const withLink = { ...body, prevHash: previous ? previous.hash : null };
  const hash = sha256(canonical(withLink));
  const signature = edSign(null, Buffer.from(hash), privateKey()).toString("base64");
  const report: ReadinessReport = { ...withLink, hash, signature, publicKey: publicKeyPem };
  appendFileSync(reportsPath, `${JSON.stringify(report)}\n`);
  return report;
}

export function verifyReport(report: ReadinessReport): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const { hash, signature, publicKey, ...body } = report;
  if (sha256(canonical(body)) !== hash) problems.push("report contents do not match its hash");
  const signatureOk = edVerify(null, Buffer.from(hash), createPublicKey(publicKey), Buffer.from(signature, "base64"));
  if (!signatureOk) problems.push("signature does not verify");
  return { ok: problems.length === 0, problems };
}

/** Human-readable report card, printed by the CLI and shown in the demo. */
export function formatReport(report: ReadinessReport): string {
  const bar = (passed: number, total: number) => {
    const filled = total === 0 ? 0 : Math.round((passed / total) * 10);
    return `${"#".repeat(filled)}${"-".repeat(10 - filled)}`;
  };

  const lines = [
    `Limulus readiness report  ${report.id}`,
    `Agent    ${report.agent.name}${report.agent.version ? ` v${report.agent.version}` : ""}`,
    `Pack     ${report.pack.id} ${report.pack.version} (${report.pack.scenarioCount} scenarios)`,
    `Score    ${report.score}/100`,
    `Level    ${report.level.toUpperCase()}`,
    "",
    "By category",
  ];

  for (const c of report.categories) {
    const critical = c.criticalFailures > 0 ? `  ${c.criticalFailures} critical failure(s)` : "";
    lines.push(`  ${c.category.padEnd(12)} ${bar(c.passed, c.total)} ${c.passed}/${c.total}${critical}`);
  }

  const failures = report.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push("", `Failures (${failures.length})`);
    for (const f of failures) {
      lines.push(`  [${f.severity}] ${f.scenarioId}  ${f.note}`);
      if (f.agentReason) lines.push(`      agent said: "${f.agentReason}"`);
    }
  }

  lines.push(
    "",
    `Signed ${report.signature.slice(0, 32)}...  prev ${report.prevHash?.slice(0, 12) ?? "none"}`,
  );
  return lines.join("\n");
}

export const reportsFile = reportsPath;
