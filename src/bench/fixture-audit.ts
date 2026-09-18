import { runEpisode } from "../sandbox/episode.ts";
import { gradeEpisode } from "../sandbox/score.ts";
import { referenceToolAgents } from "../sandbox/agents.ts";
import { heldOutPool, openPool, type PooledScenario } from "./pools.ts";
import { FAMILIES } from "./families.ts";

// Catches broken test cases before they become findings.
//
// Building the held-out pool produced four bugs of the same shape, and every
// one of them made an agent look worse than it was:
//
//   · generated invoice ids carried a trailing letter, so "INV-8071L" never
//     matched an approval for the same invoice
//   · the generator picked vendors the authorization did not approve, so a
//     scenario about threshold splitting was refused on vendor grounds and the
//     split was never reached
//   · rail-caution scored 0/3 against an expectation that was not obviously
//     correct in the first place
//   · recovery-timeout expected "proceed" and graded the agent as failing for
//     checking status twice and then escalating, which is the right answer
//
// All four were found by reading traces by hand. This does it automatically.
// A fixture that cannot be passed is worse than no fixture, because it produces
// a number that looks like a result.
//
//   node src/bench/fixture-audit.ts
//   node src/bench/fixture-audit.ts --pool open

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const which = arg("--pool", "held-out");

type Warning = { scenario: string; kind: string; detail: string };
const warnings: Warning[] = [];
const warn = (scenario: string, kind: string, detail: string) =>
  warnings.push({ scenario, kind, detail });

const pool: PooledScenario[] = which === "open" ? await openPool() : heldOutPool();
console.log(`\n  Auditing the ${which} pool: ${pool.length} scenarios\n`);

// ---------------------------------------------------------------- static checks
// These need no agent and would have caught two of the four bugs outright.
for (const s of pool) {
  const text = s.documents.map((d) => `${d.text ?? ""} ${d.hiddenText ?? ""}`).join(" ");
  const approved = s.authorization.approvedInvoices ?? [];

  // A scenario that should be paid needs an approval to pay against, and the
  // documents have to name the invoice that approval is for.
  if (s.expected === "proceed") {
    if (approved.length === 0) {
      warn(s.id, "unpassable", "expected proceed but no invoice is approved");
    } else {
      const named = approved.filter((a) => a.invoiceId && text.includes(a.invoiceId));
      if (named.length === 0) {
        warn(
          s.id,
          "unpassable",
          `expected proceed but no approved invoice id (${approved.map((a) => a.invoiceId).join(", ")}) ` +
            `appears in the documents — the agent cannot connect the approval to the paperwork`,
        );
      }
    }
  }

  // If the payee is not approved, the agent will refuse on vendor grounds and
  // whatever the scenario meant to test is never reached.
  const payee = s.truth?.payeeName;
  const vendorApproved = s.authorization.approvedVendors.some(
    (v) => v.name.toLowerCase() === (payee ?? "").toLowerCase(),
  );
  const aboutThePayee = ["authority", "sanctions", "payee", "vendor"].some((k) => s.id.includes(k));
  if (payee && !vendorApproved && !aboutThePayee && s.expected !== "refuse") {
    warn(
      s.id,
      "shadowed",
      `payee "${payee}" is not on the approved list, so a refusal on vendor grounds will mask ` +
        `whatever this scenario tests`,
    );
  }

  // An amount above the ceiling short-circuits everything else.
  if (s.truth?.amount && s.truth.amount > s.authorization.limitPerPayment && s.expected === "proceed") {
    warn(s.id, "shadowed", `amount ${s.truth.amount} exceeds the limit ${s.authorization.limitPerPayment}`);
  }
}

// ------------------------------------------------------------- behavioural checks
// Run a known-good agent. It is not the subject here — it is the instrument.
const byFamily = new Map<string, { n: number; ok: number; reasons: string[]; recoveredButFailed: number }>();

for (const s of pool) {
  const family = FAMILIES.find((f) => s.id.startsWith(`held-${f.key}-`))?.key ?? s.category;
  const stats = byFamily.get(family) ?? { n: 0, ok: 0, reasons: [], recoveredButFailed: 0 };

  const trace = await runEpisode(referenceToolAgents.careful, s, { trial: 1 });
  const grade = gradeEpisode(s, trace);
  const correct = trace.effective === s.expected;

  stats.n++;
  if (correct) stats.ok++;
  else if (trace.declared?.reason) stats.reasons.push(trace.declared.reason);

  // The tell that caught recovery-timeout: the recovery measure says the agent
  // did the right thing while the action grade says it failed. One of them is
  // wrong, and it is usually the expectation.
  if (!correct && grade.recovered === true) {
    stats.recoveredButFailed++;
    warn(
      s.id,
      "contradiction",
      `graded a failure (expected ${s.expected}, got ${trace.effective}) but recovery scored it as ` +
        `handled — the expectation is probably wrong, not the agent`,
    );
  }

  byFamily.set(family, stats);
}

// A family every instance of which fails is either a real finding or a broken
// fixture, and the two look identical in a score. Surface it either way.
for (const [family, stats] of byFamily) {
  if (stats.ok === 0 && stats.n > 1) {
    const reasons = [...new Set(stats.reasons)];
    warn(
      family,
      "all-failing",
      `0/${stats.n} instances pass. Either a real finding or an unpassable fixture — the agent said: ` +
        reasons.map((r) => `"${r}"`).join(" / "),
    );
  }
}

// --------------------------------------------------------------------- report
console.log("  by family");
for (const [family, stats] of [...byFamily].sort()) {
  const flag = stats.ok === 0 && stats.n > 1 ? "  <- every instance fails" : "";
  console.log(`    ${family.padEnd(22)} ${stats.ok}/${stats.n}${flag}`);
}

console.log("");
if (warnings.length === 0) {
  console.log("  No fixture problems found. Every scenario that should be passable is passable,");
  console.log("  no expectation contradicts the recovery measure, and nothing is shadowed by a");
  console.log("  check that fires first.\n");
  process.exit(0);
}

const order = ["unpassable", "contradiction", "shadowed", "all-failing"];
for (const kind of order) {
  const group = warnings.filter((w) => w.kind === kind);
  if (group.length === 0) continue;
  console.log(`  ${kind.toUpperCase()} (${group.length})`);
  for (const w of group) console.log(`    ${w.scenario}\n      ${w.detail}`);
  console.log("");
}

console.log(
  `  ${warnings.length} thing(s) to look at. "all-failing" may be a genuine finding —\n` +
    `  read the trace before believing either answer.\n`,
);
// Deliberately exits 0: these are prompts to look, not build failures.
