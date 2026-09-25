"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { CommandBar } from "./command-bar";
import "@/app/labs/overview.css";

// The five primary Labs destinations, shown as the sub-tab row on every deep Labs page.
const LABS_TABS = [
  { href: "/labs", label: "Overview" },
  { href: "/labs/agents", label: "Agents" },
  { href: "/labs/tests", label: "Tests" },
  { href: "/labs/arena", label: "Compare models" },
  { href: "/labs/releases", label: "Releases" },
];

// Every Labs route shares one modern top-nav shell; the classic sidebar is Production-mode only.
export function ShellFrame({ children, engine, agents, sandbox, rail }: {
  children: ReactNode;
  engine: { ok: boolean; version: string; keyed: boolean } | null;
  agents: { key: string; name: string; version: string }[];
  sandbox: boolean;
  rail: string;
}) {
  const pathname = usePathname();
  const isLabs = pathname === "/labs" || pathname.startsWith("/labs/");
  const onboarding = pathname.startsWith("/labs/agents") || pathname === "/labs/tests/new" || pathname.startsWith("/labs/jobs/");
  // Deep Labs routes (everything but the overview root and onboarding) are content pages: they
  // get the shared sub-tab nav and the content styling the test investigation already used.
  const content = isLabs && pathname !== "/labs" && !onboarding;
  const tabActive = (href: string) => (href === "/labs" ? pathname === "/labs" : pathname === href || pathname.startsWith(`${href}/`));
  if (isLabs) return <div className="labs-modern">
    <CommandBar agents={agents} engineOk={Boolean(engine?.ok)} sandbox={sandbox} compact />
    <main id="main-content" className={`labs-main${content || onboarding ? " labs-investigation" : ""}`}>
      {content && <nav className="labs-tabs investigation-nav" aria-label="Labs navigation">
        {LABS_TABS.map((t) => <Link key={t.href} href={t.href} aria-current={tabActive(t.href) ? "page" : undefined}>{t.label}</Link>)}
      </nav>}
      {children}
    </main>
  </div>;
  return <div className="flex min-h-screen">
    <Sidebar engine={engine} sandbox={sandbox} rail={rail} />
    <div className="flex min-w-0 flex-1 flex-col">
      <CommandBar agents={agents} engineOk={Boolean(engine?.ok)} sandbox={sandbox} />
      <main className="mx-auto w-full max-w-[1600px] min-w-0 flex-1 px-8 py-7">{children}</main>
    </div>
  </div>;
}
