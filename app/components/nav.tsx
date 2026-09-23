"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ groups }: { groups: { heading: string; items: { href: string; label: string }[] }[] }) {
  const path = usePathname();
  return (
    <nav className="px-2">
      {groups.map((g) => (
        <div key={g.heading} className="mb-3">
          <div className="px-2 pb-1 pt-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-3">{g.heading}</div>
          {g.items.map((it) => {
            const active = it.href === "/labs" ? path === "/labs" : path === it.href || path.startsWith(`${it.href}/`);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`block rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] ${active ? "bg-accent-soft text-accent-ink" : "text-ink-2 hover:bg-raised hover:text-ink"}`}
              >
                {it.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
