import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Refreshes the vendored reference data in reference/ from its primary sources.
// Run occasionally; commit the result. The vendored files carry their source and
// fetch date in a header line, so a stale copy is visible rather than silent.
//
//   node scripts/fetch-reference.ts

const here = dirname(fileURLToPath(import.meta.url));
const referenceDir = join(here, "..", "reference");
mkdirSync(referenceDir, { recursive: true });

// ---- OFAC SDN (Specially Designated Nationals), US Treasury --------------
// Public domain. Full file is ~5.7MB CSV; we vendor name + program only, which
// is what a payee screen needs. Columns: ent_num, SDN_Name, SDN_Type, Program, ...
const SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";

/** Minimal CSV field splitter for the SDN format (quoted fields, embedded commas). */
function splitCsv(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else current += ch;
  }
  fields.push(current.trim());
  return fields;
}

const response = await fetch(SDN_URL);
if (!response.ok) {
  console.error(`SDN download failed: ${response.status}`);
  process.exit(1);
}
const csv = await response.text();
const rows = csv.split("\n").filter((l) => l.trim());
const lines: string[] = [
  `# OFAC SDN list — name\tprogram`,
  `# source: ${SDN_URL} (US Treasury, public domain)`,
  `# fetched: ${new Date().toISOString().slice(0, 10)}`,
  `# refresh: node scripts/fetch-reference.ts`,
];
for (const row of rows) {
  const fields = splitCsv(row);
  const name = fields[1]?.replace(/^"|"$/g, "");
  const program = fields[3]?.replace(/^"|"$/g, "");
  if (name && name !== "-0-") lines.push(`${name}\t${program === "-0-" ? "" : (program ?? "")}`);
}
writeFileSync(join(referenceDir, "ofac-sdn.tsv"), lines.join("\n") + "\n");
console.log(`reference/ofac-sdn.tsv: ${lines.length - 4} entries (fetched ${new Date().toISOString().slice(0, 10)})`);
