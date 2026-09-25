import type { ReactNode } from "react";
import { environment, health, referenceAgents } from "@/lib/api";
import { ShellFrame } from "./shell-frame";

// One platform, two modes. The sidebar switches mode; the command bar carries
// search and the one action that matters in that mode. The environment is
// named in the sidebar and in the strip under every Labs header, so sandbox
// and production can never be confused.

export async function Shell({ children }: { children: ReactNode }) {
  const [h, agents, env] = await Promise.all([health(), referenceAgents().catch(() => []), environment()]);
  return (
    <ShellFrame engine={h ? { ok: h.ok, version: h.version, keyed: h.authRequired } : null} agents={agents} sandbox={env.sandbox} rail={env.rail}>
      {children}
    </ShellFrame>
  );
}

export { Breadcrumb } from "./breadcrumb";
