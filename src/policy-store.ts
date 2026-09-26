import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, sha256 } from "./record.ts";
import { authorization as seedAuthorization } from "./scenarios.ts";
import type { Authorization } from "./types.ts";

// The authorization an agent is working under. In a deployment this comes from
// the customer's approval workflow or spending policy; here it is a stored
// document so the MCP tools have something to check against.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LIMULUS_DATA_DIR ?? join(here, "..", "data");
const policyPath = join(dataDir, "policy.json");

export function loadAuthorization(): Authorization {
  if (!existsSync(policyPath)) return seedAuthorization;
  return JSON.parse(readFileSync(policyPath, "utf8")) as Authorization;
}

export function saveAuthorization(authorization: Authorization): { policyId: string } {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  writeFileSync(policyPath, JSON.stringify(authorization, null, 2));
  return { policyId: policyId(authorization) };
}

/**
 * Content-addressed policy id: the same policy always has the same id, and any
 * change to limits, vendors or approvals produces a different one. A decision
 * record can then be tied to the exact policy that was in force.
 */
export function policyId(authorization: Authorization): string {
  return `pol_${sha256(canonical(authorization)).slice(0, 32)}`;
}
