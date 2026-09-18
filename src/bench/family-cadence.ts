import { FAMILIES } from "./families.ts";

// Is the library still growing?
//
//   node src/bench/family-cadence.ts
//   node src/bench/family-cadence.ts --enforce      non-zero exit if it has slipped
//
// This measures the one thing the subscription argument rests on, and it is not
// the thing it looks like from the outside.
//
// Instances are free. The generator mints as many as anyone wants from a seed, so
// a cohort is never scarce and rotating one costs nothing. Families are scarce:
// there are as many shapes in the library as somebody has sat down and written.
//
// That asymmetry decides whether requalification means anything. A customer who
// requalifies monthly meets every shape in the library in the first month. From
// then on their agent is being improved against a fixed set, their score climbs,
// and the risk it is supposed to track does not move. The score becomes a
// measure of how long they have been a customer.
//
// So the renewal argument is not "run it again", which is theatre by month three.
// It is "the library has failure modes in it that did not exist when you last
// ran" — and that is a claim about this list growing, which is checkable, which
// is why it is checked here rather than asserted in a deck.
//
// The target below is a commitment, not an observation. Missing it is not a bug
// in the code.

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const enforce = process.argv.includes("--enforce");

/** Families we intend to add per 30 days, and the window judged against. */
const TARGET_PER_MONTH = Number(arg("--target", "2"));
const WINDOW_DAYS = Number(arg("--window", "90"));

const now = new Date();
const daysAgo = (iso: string) => Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);

const sorted = [...FAMILIES].sort((a, b) => b.added.localeCompare(a.added));
const scored = FAMILIES.filter((f) => f.origin !== "control");

console.log(`\n  Family library — ${FAMILIES.length} families (${scored.length} scored, ${FAMILIES.length - scored.length} control)\n`);

const width = Math.max(...FAMILIES.map((f) => f.key.length));
console.log(`  ${"family".padEnd(width)}  added       age    origin`);
for (const f of sorted) {
  const age = daysAgo(f.added);
  console.log(`  ${f.key.padEnd(width)}  ${f.added}  ${String(`${age}d`).padStart(5)}  ${f.origin}`);
}

// ---- cadence ----------------------------------------------------------------
// Counting every family inside the window would report the founding library as
// though it were growth: while the library is younger than the window, all of it
// falls inside, the target is trivially met, and the check says "on track" having
// measured nothing. So the founding set is excluded and only later additions
// count. That makes the first report read as behind, which is correct — nothing
// has been added since the library was written.
const founded = FAMILIES.reduce((earliest, f) => (f.added < earliest ? f.added : earliest), sorted[0].added);
const foundingSet = FAMILIES.filter((f) => f.added === founded);
const growth = FAMILIES.filter((f) => f.added > founded);
const inWindow = growth.filter((f) => daysAgo(f.added) <= WINDOW_DAYS);
const expected = (TARGET_PER_MONTH * WINDOW_DAYS) / 30;
const newest = daysAgo(sorted[0].added);

console.log("");
console.log(`  founded        ${founded} with ${foundingSet.length} families, ${daysAgo(founded)} days ago`);
console.log(`  added since    ${growth.length} (${inWindow.length} inside the last ${WINDOW_DAYS} days, target ${expected.toFixed(0)})`);
console.log(`  newest family  ${newest} days old`);

// ---- what the customer actually sees ----------------------------------------
// The number that matters to a buyer is not how many scenarios exist, it is how
// many distinct shapes they have not already optimised against.
console.log("");
console.log(`  What a customer meets, given instances are unlimited and shapes are not:`);
console.log(`    month 1        all ${scored.length} scored shapes`);
console.log(`    month 6        ${scored.length} + whatever was added since — at ${TARGET_PER_MONTH}/month that is ${scored.length + TARGET_PER_MONTH * 5}`);
console.log(`    at 0/month     still ${scored.length}, and a rising score means nothing`);

// ---- origin mix -------------------------------------------------------------
// Families derived from real events are worth more than ones derived from
// reports, because they are evidence that the production loop is feeding the Lab
// rather than the Lab being written in isolation.
const byOrigin = new Map<string, number>();
for (const f of FAMILIES) byOrigin.set(f.origin, (byOrigin.get(f.origin) ?? 0) + 1);

console.log("");
console.log("  where they came from");
for (const [origin, count] of [...byOrigin].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${origin.padEnd(20)} ${count}`);
}

const fromTheField = (byOrigin.get("production-event") ?? 0) + (byOrigin.get("customer-near-miss") ?? 0);
if (fromTheField === 0) {
  console.log("");
  console.log(`    None yet from production or a customer near-miss. Every family here was written`);
  console.log(`    from published fraud typology, which is a reasonable start and a weak moat: a`);
  console.log(`    competitor can read the same sources. The families that cannot be copied are the`);
  console.log(`    ones that come out of real traffic.`);
}

// ---- verdict ----------------------------------------------------------------
const slipped = inWindow.length < expected;

console.log("");
if (slipped) {
  console.log(`  BEHIND — ${inWindow.length} in the last ${WINDOW_DAYS} days against a target of ${expected.toFixed(0)}.`);
  console.log("");
  console.log(`  This is a commitment that has slipped, not a defect. What closes it:`);
  console.log(`    · a blocked payment or near-miss from production, written up as a family`);
  console.log(`    · a customer's own failing scenario, generalised into one`);
  console.log(`    · a failure mode found by running a live model, as the rail experiment did`);
} else {
  console.log(`  ON TRACK — ${inWindow.length} added in the last ${WINDOW_DAYS} days, target ${expected.toFixed(0)}.`);
}
console.log("");

if (enforce && slipped) process.exit(1);
