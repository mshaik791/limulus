import Link from "next/link";
import type { ReactNode } from "react";
import { health } from "@/lib/api";
import { Nav } from "./nav";

// One platform, two modes. Labs before deployment; Production after. Nothing
// in the rail links to a screen that does not exist, and the environment is
// impossible to mistake: sandbox is named at the bottom of every screen.

export const LABS_NAV = [
  { href: "/labs", label: "Overview" },
  { href: "/labs/tests", label: "Test Runs" },
  { href: "/labs/arena", label: "Model Arena" },
  { href: "/labs/releases", label: "Release Gates" },
  { href: "/labs/policies", label: "Policies" },
  { href: "/labs/qualifications", label: "Assurance Checks" },
];
export const CORE_NAV = [
  { href: "/production", label: "Shadow Mode" },
  { href: "/decisions", label: "Production" },
  { href: "/incidents", label: "Incidents" },
  { href: "/evidence", label: "Evidence" },
];

export async function Shell({ children }: { children: ReactNode }) {
  const h = await health();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col border-r border-line bg-sunken">
        <div className="flex items-center gap-3 px-5 pb-4 pt-5">
          <Mark />
          <div>
            <div className="text-[15px] font-semibold leading-tight">Limulus</div>
            <div className="text-[11px] leading-tight text-ink-3">Financial Agent Assurance</div>
          </div>
        </div>
        <Nav labs={LABS_NAV} core={CORE_NAV} />
        <div className="mt-auto border-t border-line px-5 py-4 text-[11.5px] text-ink-3">
          <div className="mb-2 text-ink-2">Workspace · local</div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-[4px] bg-warn-soft px-1.5 py-[1px] text-[10px] font-semibold tracking-[0.08em] text-warn-ink">SANDBOX</span>
            <span>No payment rails connected</span>
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${h?.ok ? "bg-good" : "bg-crit"}`} />
            {h?.ok ? `engine ${h.version}${h.authRequired ? " · keyed" : ""}` : "engine offline"}
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-10 py-8">{children}</main>
    </div>
  );
}

/** The horseshoe arc. Not a crab. */
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 26 26" aria-hidden>
      <path d="M4 20 V12 a9 9 0 0 1 18 0 V20" fill="none" stroke="var(--accent)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M9 20 V13 a4 4 0 0 1 8 0 V20" fill="none" stroke="var(--accent-ink)" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

export function Breadcrumb({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="mb-3 text-[12px] text-ink-3">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1.5">/</span>}
          {it.href ? (
            <Link href={it.href} className="hover:text-accent-ink">
              {it.label}
            </Link>
          ) : (
            <span className="text-ink-2">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
