// Formatting for a console that shows money, rates and hashes all day. Money
// and counts are formatted here, once, so a screen cannot invent its own
// rounding; a rate never leaves without its n.

export const money = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);

export const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const int = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** "83 of 96", never a bare percentage. */
export const ofN = (value: number, of: number) => `${int(value)} of ${int(of)}`;

export const pct = (value: number, of: number) => (of === 0 ? "–" : `${Math.round((value / of) * 100)}%`);

export const short = (id: string, n = 12) => (id.length > n + 3 ? `${id.slice(0, n)}…` : id);

export const when = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};

export const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export const ago = (iso: string, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : n < 60_000 ? `${(n / 1000).toFixed(1)} s` : `${(n / 60_000).toFixed(1)} min`);

/** Readiness rungs, lowest first. */
export const LADDER = ["experimental", "shadow-ready", "human-supervised", "limited-autonomous", "expanded-autonomous"] as const;
