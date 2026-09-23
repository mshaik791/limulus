import type { ReactNode } from "react";
import { health, referenceAgents } from "@/lib/api";
import { Sidebar } from "./sidebar";
import { CommandBar } from "./command-bar";

// One platform, two modes. The sidebar switches mode; the command bar carries
// search and the one action that matters in that mode. The environment is
// named in the sidebar and in the strip under every Labs header, so sandbox
// and production can never be confused.

export async function Shell({ children }: { children: ReactNode }) {
  const [h, agents] = await Promise.all([health(), referenceAgents().catch(() => [])]);
  return (
    <div className="flex min-h-screen">
      <Sidebar engine={h ? { ok: h.ok, version: h.version, keyed: h.authRequired } : null} />
      <div className="flex min-w-0 flex-1 flex-col">
        <CommandBar agents={agents} engineOk={Boolean(h?.ok)} />
        <main className="mx-auto w-full max-w-[1650px] min-w-0 flex-1 px-8 py-7">{children}</main>
      </div>
    </div>
  );
}

export { Breadcrumb } from "./breadcrumb";
