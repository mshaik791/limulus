"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CommandBar } from "./command-bar";
import { SectionNav } from "@/app/labs/labs-ui";
import "@/app/labs/overview.css";

// One shell for the whole product. The header bar and the sub-tab row are
// identical on every route; only the tabs' contents change with the section
// (Test, Qualify, Monitor, Protect). Moving between sections never swaps the
// chrome — that is the point.
export function ShellFrame({ children, engine, agents, sandbox }: {
  children: ReactNode;
  engine: { ok: boolean; version: string; keyed: boolean } | null;
  agents: { key: string; name: string; version: string }[];
  sandbox: boolean;
  rail?: string;
}) {
  const pathname = usePathname();
  // Onboarding flows render their own nav inline, so the shell stays out.
  const onboarding = pathname.startsWith("/labs/agents") || pathname === "/labs/tests/new" || pathname.startsWith("/labs/jobs/");
  const overview = pathname === "/labs";
  return (
    <div className="labs-modern">
      <CommandBar agents={agents} engineOk={Boolean(engine?.ok)} sandbox={sandbox} />
      <main id="main-content" className={`labs-main${overview ? "" : " labs-investigation"}`}>
        {!onboarding && !overview && <SectionNav pathname={pathname} />}
        {/* Keyed by route so content settles in on navigation — motion answers the click. */}
        <div key={pathname} className="route-rise">{children}</div>
      </main>
    </div>
  );
}
