"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { CommandBar } from "./command-bar";
import "@/app/labs/overview.css";

// The overview and test investigations share the Labs shell.
export function ShellFrame({ children, engine, agents, sandbox, rail }: {
  children: ReactNode;
  engine: { ok: boolean; version: string; keyed: boolean } | null;
  agents: { key: string; name: string; version: string }[];
  sandbox: boolean;
  rail: string;
}) {
  const pathname = usePathname();
  const investigation = pathname === "/labs/tests" || pathname.startsWith("/labs/tests/");
  const overview = pathname === "/labs" || investigation;
  if (overview) return <div className="labs-modern">
    <CommandBar agents={agents} engineOk={Boolean(engine?.ok)} sandbox={sandbox} compact />
    <main id="main-content" className={`labs-main${investigation ? " labs-investigation" : ""}`}>
      {investigation && <nav className="labs-tabs investigation-nav" aria-label="Labs navigation">
        <Link href="/labs">Overview</Link><Link href="/labs/tests" aria-current="page">Tests</Link><Link href="/labs/arena">Compare models</Link><Link href="/labs/releases">Releases</Link>
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
