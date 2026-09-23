import type { DecisionRecord, Outcome } from "./api";

// A production miss: the gate's decision and the rail's outcome disagree in
// the direction that costs money. A release the rail then returned, duplicated
// or mismatched; or a hold or escalation that settled anyway. Never rendered
// as an ordinary success; each one is listed under Incidents.

export function productionMiss(r: DecisionRecord, o: Outcome | undefined): string | null {
  if (!o) return null;
  if (o.status === "unauthorized") return "settled although the decision did not release it";
  if (r.outcome === "released" && (o.status === "duplicate" || o.status === "returned" || o.status === "mismatch")) return `released, then the rail reported ${o.status}`;
  return null;
}
