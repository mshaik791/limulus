import Link from "next/link";
import type { ReactNode } from "react";

// One product, one shell. The lifecycle is the primary navigation — Test,
// Qualify, Monitor, Protect — and every section keeps the same header bar and
// the same sub-tab row position, so moving between stages is a tab change,
// never a change of application. This is the single source of truth for both
// levels; the header and every page shell derive from it and cannot drift.

export type Section = { key: "test" | "qualify" | "monitor" | "protect"; label: string; href: string; hint: string; tabs: [string, string][] };

export const SECTIONS: Section[] = [
  { key: "test", label: "Test", href: "/labs", hint: "Run agents against failure scenarios in the sandbox", tabs: [["/labs", "Overview"], ["/labs/agents", "Agents"], ["/labs/tests", "Tests"], ["/labs/arena", "Compare models"]] },
  { key: "qualify", label: "Qualify", href: "/labs/releases", hint: "Gate a version on evidence before it may pay", tabs: [["/labs/releases", "Releases"], ["/labs/policies", "Policies"], ["/labs/qualifications", "Assurance checks"]] },
  { key: "monitor", label: "Monitor", href: "/production", hint: "Observe real decisions in Shadow Mode, read-only", tabs: [["/production", "Shadow Mode"], ["/evidence", "Evidence"]] },
  { key: "protect", label: "Protect", href: "/decisions", hint: "The gate's decisions, and where the rail contradicted one", tabs: [["/decisions", "Decisions"], ["/incidents", "Incidents"]] },
];

const owns = (href: string, path: string) => (href === "/labs" ? path === "/labs" : path === href || path.startsWith(`${href}/`));

/** The section that owns a pathname — by tab prefix, falling back by area. */
export function activeSection(pathname: string): Section {
  for (const s of SECTIONS) if (s.tabs.some(([href]) => owns(href, pathname))) return s;
  return pathname.startsWith("/labs") ? SECTIONS[0] : SECTIONS[2];
}

/** The href of the active section's tab that owns the pathname, or "". */
export function activeTab(pathname: string): string {
  return activeSection(pathname).tabs.find(([href]) => owns(href, pathname))?.[0] ?? "";
}

/** The sub-tab row for whichever section owns the pathname. Same markup, same
    position, on every screen in the product. */
export function SectionNav({ pathname }: { pathname: string }) {
  const section = activeSection(pathname);
  const active = activeTab(pathname);
  return (
    <nav className="labs-tabs investigation-nav" aria-label={`${section.label} navigation`}>
      {section.tabs.map(([href, label]) => (
        <Link key={href} href={href} aria-current={href === active ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}

/** Back-compat wrapper for the onboarding pages that render their own nav. */
export function LabsNav({ current }: { current: string }) {
  return <SectionNav pathname={current} />;
}

export function StatePill({ tone, children }: { tone: "pass" | "fail" | "warn" | "unknown"; children: ReactNode }) {
  return <span className={`labs-state is-${tone}`}>{children}</span>;
}

export { ProtocolExample } from "./protocol-example";
