import Link from "next/link";
import type { ReactNode } from "react";

// Small pieces shared by the Labs onboarding screens, in the approved shell's
// classes. Colour carries state; every state also has its word.

export function LabsNav({ current }: { current: string }) {
  const items: [string, string][] = [["/labs", "Overview"], ["/labs/agents", "Agents"], ["/labs/tests", "Tests"], ["/labs/arena", "Compare models"], ["/labs/releases", "Releases"]];
  return (
    <nav className="labs-tabs investigation-nav" aria-label="Labs navigation">
      {items.map(([href, label]) => (
        <Link key={href} href={href} aria-current={href === current ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}

export function StatePill({ tone, children }: { tone: "pass" | "fail" | "warn" | "unknown"; children: ReactNode }) {
  return <span className={`labs-state is-${tone}`}>{children}</span>;
}

/** The protocol, shown from the shape the engine actually sends and expects. */
export function ProtocolExample() {
  return (
    <details className="labs-protocol">
      <summary>The protocol, exactly</summary>
      <p>Each step, the engine POSTs one turn to your endpoint as JSON and expects one step back. Your endpoint holds no tools: it proposes, the engine executes every action in a simulated world.</p>
      <pre>{`POST <your endpoint>              (Authorization header if you configure one)
{
  "task": "Pay invoice INV-2291 from Northline Steel…",
  "authorization": { "policyVersion": "v12", "principal": "j.ortiz", "limitPerPayment": 75000, "currency": "USD",
                     "approvedVendors": [...], "approvedInvoices": [...], "requiredChecks": [...] },
  "documents": [ { "name": "INV-2291.pdf", "type": "invoice", "text": "…" } ],
  "tools": [ { "name": "lookup_vendor", "description": "…", "parameters": ["name"] }, … ],
  "history": [ { "tool": "lookup_vendor", "args": {…}, "result": {…} } ],
  "step": 1, "maxSteps": 8
}

← 200 application/json, one of:
{ "type": "tool_call", "tool": "lookup_vendor", "args": { "name": "Northline Steel" }, "thought": "…", "model": "your-model-id" }
{ "type": "finish", "action": "proceed" | "ask" | "refuse", "reason": "…" }

Tools the engine simulates: lookup_vendor, create_payment, get_payment_status, cancel_payment,
request_human_approval, change_vendor_bank_details (and check_payment when a gate is on).
A connection check sends one turn with "check": true whose reply is validated and never executed.
A non-2xx or non-JSON reply becomes an unusable trial, never a guessed decision.`}</pre>
    </details>
  );
}
