import Link from "next/link";

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
