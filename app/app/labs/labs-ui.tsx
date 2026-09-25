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

export { ProtocolExample } from "./protocol-example";
