"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string };

export function Nav({ labs, core }: { labs: Item[]; core: Item[] }) {
  const path = usePathname();
  const inLabs = path.startsWith("/labs");
  const items = inLabs ? labs : core;
  return (
    <nav className="px-3">
      <div className="mb-4 grid grid-cols-2 rounded-[var(--radius-sm)] border border-line bg-surface p-[3px] text-[12px]">
        <Link href="/labs" className={`rounded-[5px] py-1.5 text-center ${inLabs ? "bg-accent-soft font-medium text-accent-ink" : "text-ink-3 hover:text-ink-2"}`}>
          Labs
        </Link>
        <Link href="/production" className={`rounded-[5px] py-1.5 text-center ${!inLabs ? "bg-accent-soft font-medium text-accent-ink" : "text-ink-3 hover:text-ink-2"}`}>
          Production
        </Link>
      </div>
      <div className="eyebrow px-2 pb-1.5">{inLabs ? "Labs" : "Core"}</div>
      {items.map((it) => {
        const active = it.href === "/labs" ? path === "/labs" : path === it.href || path.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`mb-[2px] block rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] ${active ? "bg-surface-3 text-ink" : "text-ink-2 hover:bg-surface hover:text-ink"}`}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
