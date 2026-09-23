import Link from "next/link";
import type { ReactNode } from "react";
import { health } from "@/lib/api";
import { Nav } from "./nav";

// One platform, two modes. Labs is before deployment; Core is production.
// Nothing in the rail links to a screen that does not exist yet.

export const NAV = {
  labs: [
    { href: "/labs", label: "Overview" },
    { href: "/labs/tests", label: "Test runs" },
    { href: "/labs/arena", label: "Compare" },
    { href: "/labs/releases", label: "Releases" },
    { href: "/labs/policies", label: "Policies" },
    { href: "/labs/qualifications", label: "Qualifications" },
  ],
  core: [
    { href: "/production", label: "Shadow" },
    { href: "/evidence", label: "Evidence" },
  ],
};

export async function Shell({ children }: { children: ReactNode }) {
  const h = await health();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[210px] shrink-0 flex-col border-r border-line bg-sunken">
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <Mark />
          <div>
            <div className="text-[15px] font-semibold leading-tight">Limulus</div>
            <div className="text-[11px] leading-tight text-ink-3">Continuous assurance</div>
          </div>
        </div>
        <Nav groups={[{ heading: "Labs", items: NAV.labs }, { heading: "Core", items: NAV.core }]} />
        <div className="mt-auto border-t border-line px-4 py-3 text-[11px] text-ink-3">
          <div className="flex items-center gap-2">
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${h?.ok ? "bg-good" : "bg-crit"}`} />
            {h?.ok ? `engine ${h.version}${h.authRequired ? ", keyed" : ""}` : "engine offline"}
          </div>
          <div className="mt-1">sandbox · no rail attached</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-7 py-6">{children}</main>
    </div>
  );
}

/** The horseshoe arc, in one colour. Not a crab. */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
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
