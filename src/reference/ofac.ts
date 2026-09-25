import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Payee screening against the real OFAC SDN list, vendored from the US Treasury
// download (reference/ofac-sdn.tsv — source and fetch date in its header).
//
// What this is: a deterministic name screen — normalised exact match, with
// common corporate suffixes ignored. The SDN file carries aliases as their own
// rows, which does much of the work fuzzy matching would otherwise do.
//
// What this is NOT: a compliance-grade screening service. No transliteration,
// no phonetic or edit-distance matching, no date-of-birth or address
// disambiguation. A production deployment would sit a specialist provider here;
// this makes our sanctions scenarios test against the real list rather than
// three invented names, which is the point.

const here = dirname(fileURLToPath(import.meta.url));
const listPath = join(here, "..", "..", "reference", "ofac-sdn.tsv");

export type SdnEntry = { name: string; program: string };
export type SdnHit = { hit: true; entry: SdnEntry; matched: "exact" | "suffix-insensitive" } | { hit: false };

/** Corporate dressing that should not defeat a name match. */
const SUFFIXES =
  /\b(CO|COMPANY|CORP|CORPORATION|INC|INCORPORATED|LTD|LIMITED|LLC|LLP|SA|SAS|AG|GMBH|BV|NV|OJSC|PJSC|OOO|JSC|PLC|DOO|SPA|SRL)\b\.?/g;

export const normalizeName = (name: string): string =>
  name
    .toUpperCase()
    .replace(/[.,'’\-\/()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripSuffixes = (normalized: string): string =>
  normalized.replace(SUFFIXES, " ").replace(/\s+/g, " ").trim();

let cache: { entries: SdnEntry[]; exact: Map<string, SdnEntry>; stripped: Map<string, SdnEntry>; fetched: string } | null = null;

function load() {
  if (cache) return cache;
  if (!existsSync(listPath)) {
    // Missing reference data is loud, not a silent all-clear: a screen that
    // cannot see the list must not report "no hit".
    throw new Error(`reference/ofac-sdn.tsv missing — run: node scripts/fetch-reference.ts`);
  }
  const lines = readFileSync(listPath, "utf8").split("\n");
  const fetched = lines.find((l) => l.startsWith("# fetched:"))?.slice(10).trim() ?? "unknown";
  const entries: SdnEntry[] = [];
  const exact = new Map<string, SdnEntry>();
  const stripped = new Map<string, SdnEntry>();
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [name, program = ""] = line.split("\t");
    const entry = { name, program };
    entries.push(entry);
    exact.set(normalizeName(name), entry);
    const bare = stripSuffixes(normalizeName(name));
    if (bare) stripped.set(bare, entry);
  }
  cache = { entries, exact, stripped, fetched };
  return cache;
}

/** Screen a payee name against the SDN list. Deterministic; no network. */
export function screenPayee(name: string): SdnHit {
  const { exact, stripped } = load();
  const normalized = normalizeName(name);
  const exactHit = exact.get(normalized);
  if (exactHit) return { hit: true, entry: exactHit, matched: "exact" };
  const bare = stripSuffixes(normalized);
  const suffixHit = bare ? stripped.get(bare) : undefined;
  if (suffixHit) return { hit: true, entry: suffixHit, matched: "suffix-insensitive" };
  return { hit: false };
}

/** How many entries are loaded, and when the vendored list was fetched. */
export function sdnInfo(): { entries: number; fetched: string } {
  const { entries, fetched } = load();
  return { entries: entries.length, fetched };
}

/**
 * A deterministic sample of real SDN names for scenario generation, seeded so
 * the same seed always yields the same names. Filters to plain company-like
 * names that fit an invoice without transliteration artifacts.
 */
export function sdnSample(pick: (max: number) => number, count: number): string[] {
  const { entries } = load();
  const plausible = entries.filter((e) => /^[A-Z0-9 .,&'()-]+$/.test(e.name) && e.name.length <= 40);
  const out: string[] = [];
  const seen = new Set<number>();
  while (out.length < count && seen.size < plausible.length) {
    const i = pick(plausible.length);
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(plausible[i].name);
  }
  return out;
}
