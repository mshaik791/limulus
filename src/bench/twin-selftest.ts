import { FAMILIES, rngFrom } from "./families.ts";
import {
  familyOf,
  heldOutSecrets,
  publicFamilySamples,
  redactSecrets,
  twinFor,
  twinIsDistinct,
  uniqueHeldOutSentences,
} from "./twin.ts";
import type { Scenario } from "./types.ts";

// Checks the machinery that lets a failure leave without the exam leaving with it.
//
//   node src/bench/twin-selftest.ts
//
// Deliberately independent of data/held-out: it builds its own private cohort
// from a seed it invents, so this runs on a fresh clone with no generated pool.
// The properties being checked are about the mechanism, not about any one cohort.

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

/** A stand-in cohort, built the way generate-held-out.ts builds a real one. */
function privateCohort(seed: string, cohort: string, perFamily = 2): Scenario[] {
  const out: Scenario[] = [];
  for (const family of FAMILIES) {
    for (let n = 1; n <= perFamily; n++) {
      const built = family.build(rngFrom(`${seed}:${cohort}:${family.key}:${n}`), n);
      out.push({
        ...built,
        id: `${built.id}-${cohort}`,
        category: family.category,
        severity: family.severity,
        expected: family.expected,
        source: family.source,
      });
    }
  }
  return out;
}

const held = privateCohort("a-seed-that-is-not-in-git", "ctest");
const publicBaseline = publicFamilySamples();

console.log(`\n  ${held.length} private instances, ${publicBaseline.length} public samples\n`);

// ---- family recognition ----------------------------------------------------
// The id format is `held-<family>-<n>-<cohort>` and family keys contain hyphens,
// so naive splitting reads "held-threshold-split-2-ctest" as family "threshold".
check(
  "a family key containing a hyphen is read whole",
  familyOf("held-threshold-split-2-ctest") === "threshold-split",
  String(familyOf("held-threshold-split-2-ctest")),
);
check("every private instance maps back to its family", held.every((s) => familyOf(s.id) !== undefined));
check(
  "a hand-written scenario has no family and no twin",
  familyOf("bank-change-hidden-in-thread") === undefined,
);

// ---- the twin is a stand-in, not a copy ------------------------------------
for (const original of held.slice(0, 6)) {
  const twin = twinFor(original);
  const distinct = twinIsDistinct(twin.scenario, original);
  check(`twin of ${original.id} is a distinct instance`, distinct.ok, distinct.reason ?? "");
  check(
    `twin of ${original.id} tests the same thing`,
    twin.scenario.expected === original.expected && twin.family === familyOf(original.id),
  );
}

// A twin is reproducible from its salt, which is what lets a customer rebuild
// one and what lets us regenerate a bundle without storing it.
{
  const a = twinFor(held[0], { salt: "fixedsalt123" });
  const b = twinFor(held[0], { salt: "fixedsalt123" });
  check("the same salt rebuilds the same twin", a.scenario.task === b.scenario.task);
  const c = twinFor(held[0], { salt: "differentsalt" });
  check("a different salt gives a different twin", a.scenario.task !== c.scenario.task);
}

// ---- what counts as a secret ----------------------------------------------
const secrets = heldOutSecrets(held, publicBaseline);
check("the private cohort has identifiers worth protecting", secrets.length > 0, `${secrets.length} found`);

// PO-44812 is written into families.ts as a constant, so it appears in every
// instance and in the public baseline. Treating it as a secret blocked every
// bundle until this was fixed.
const publicConstant = publicBaseline
  .flatMap((s) => {
    const prose = [s.task, ...s.documents.map((d) => `${d.text ?? ""} ${d.hiddenText ?? ""}`)].join(" ");
    return prose.match(/\b[A-Z]{2,6}-[0-9][0-9A-Z-]*\b/g) ?? [];
  })
  .map((x) => x.toLowerCase())
  // A token is a constant only if it recurs across independently generated
  // samples; one that appears once is a per-instance value in the baseline too.
  .filter((tok, _i, all) => all.filter((t) => t === tok).length > 1)[0];
check(
  `a constant recurring across public samples is not a secret (${publicConstant ?? "none found"})`,
  publicConstant !== undefined && !secrets.includes(publicConstant),
);

// An invoice id minted per instance is the thing that must not travel.
const mintedId = held[0].authorization.approvedInvoices[0]?.invoiceId?.toLowerCase();
check(
  `a per-instance invoice id is a secret (${mintedId})`,
  mintedId !== undefined && secrets.includes(mintedId),
);

// A twin must not itself contain any secret, or the bundle could never ship.
{
  const twinText = held
    .slice(0, 6)
    .map((o) => JSON.stringify(twinFor(o).scenario))
    .join(" ")
    .toLowerCase();
  const inTwin = secrets.filter((x) => twinText.includes(x));
  check("twins carry none of the cohort's identifiers", inTwin.length === 0, inTwin.slice(0, 3).join(", "));
}

// Family wording is shared by design, so it must not register as a leak.
const unique = uniqueHeldOutSentences(held, publicBaseline);
check(
  "family boilerplate is not mistaken for instance-specific prose",
  unique.length === 0,
  unique.length > 0 ? `${unique.length} flagged, first: "${unique[0].slice(0, 60)}"` : "",
);

// ---- redaction ------------------------------------------------------------
{
  const id = mintedId!.toUpperCase();
  const trace = `paid ${id} then queried ${id} again, and separately paid ${held[1].authorization.approvedInvoices[0].invoiceId}`;
  const { text, replaced } = redactSecrets(trace, secrets);

  check("redaction removes the identifier", !text.toLowerCase().includes(mintedId!));
  check("redaction replaced both distinct identifiers", replaced === 2, `replaced=${replaced}`);

  // The point of consistency: a duplicate payment has to still read as one.
  const placeholder = text.match(/INV-REDACTED-\d+/)?.[0];
  check(
    "one identifier maps to one placeholder, so a repeat still looks like a repeat",
    placeholder !== undefined && text.split(placeholder).length - 1 === 2,
    placeholder ?? "none",
  );
  check("the placeholder keeps the shape of what it replaced", /^INV-REDACTED-\d+$/.test(placeholder ?? ""));
}

// ---- the check that must not silently pass ---------------------------------
// If the leak check ever stops detecting an actual leak, every bundle after that
// ships the exam. So: plant one and confirm it is caught.
{
  const planted = `some trace text mentioning ${held[0].authorization.approvedInvoices[0].invoiceId} verbatim`;
  const caught = secrets.filter((x) => planted.toLowerCase().includes(x));
  check("a planted identifier is detected", caught.length > 0, caught.join(", "));

  const plantedProse = held[0].documents[0]?.text ?? "";
  const { text } = redactSecrets(plantedProse, secrets);
  check(
    "redacting a held-out document leaves no identifier behind",
    secrets.every((x) => !text.toLowerCase().includes(x)),
  );
}

// Two cohorts from the same seed must not share particulars, or rotating the
// cohort would not actually rotate anything.
{
  const other = privateCohort("a-seed-that-is-not-in-git", "cother");
  const a = new Set(heldOutSecrets(held, publicBaseline));
  const shared = heldOutSecrets(other, publicBaseline).filter((x) => a.has(x));
  check("a different cohort has different particulars", shared.length === 0, shared.slice(0, 3).join(", "));
}

console.log(`\n${failures === 0 ? "All twin checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
