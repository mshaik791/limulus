import Link from "next/link";
import type { ReactNode } from "react";

// Small pieces shared by the Labs onboarding screens, in the approved shell's
// classes. Colour carries state; every state also has its word.

// The five primary Labs destinations — the single source of truth for the sub-tab row, shown on
// onboarding pages (via <LabsNav/>) and on every deep Labs page (via the shell). Keep in sync in
// exactly one place so the onboarding and content shells can never drift apart.
export const LABS_TABS: [string, string][] = [["/labs", "Overview"], ["/labs/agents", "Agents"], ["/labs/tests", "Tests"], ["/labs/arena", "Compare models"], ["/labs/releases", "Releases"]];

// The href of the tab that owns a given pathname (prefix match), or "" when none does.
export function activeLabsTab(pathname: string): string {
  return LABS_TABS.find(([href]) => (href === "/labs" ? pathname === "/labs" : pathname === href || pathname.startsWith(`${href}/`)))?.[0] ?? "";
}

export function LabsNav({ current }: { current: string }) {
  return (
    <nav className="labs-tabs investigation-nav" aria-label="Labs navigation">
      {LABS_TABS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={href === current ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}

export function StatePill({ tone, children }: { tone: "pass" | "fail" | "warn" | "unknown"; children: ReactNode }) {
  return <span className={`labs-state is-${tone}`}>{children}</span>;
}

export { ProtocolExample } from "./protocol-example";
