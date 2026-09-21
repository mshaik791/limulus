import { type Outcome, summarizeArm, formatRate } from "./outcomes.ts";

// The accounting the headline numbers rest on, exercised on synthetic outcomes
// so it needs no LLM key and no live rail. Two things must never regress:
//   - an agent that never called the gate is its own outcome, counted and kept
//     out of the friction denominator (build prompt §4);
//   - a false-block counts a correct payment the gate refused, and NOT the gate
//     correctly refusing a wrong one (build prompt Phase 4).
// Every wrong number this product has reported was a denominator bug (FINDINGS.md).
//
//   node src/experiments/skipped-control-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

let seq = 0;
const row = (over: Partial<Outcome>): Outcome => ({
  condition: "limulus",
  scenario: "credit-memo",
  trial: ++seq,
  invoiceId: `INV-T${seq}`,
  attempted: false,
  attemptedWrongAccount: false,
  attemptedWrongAmount: false,
  moved: false,
  skippedControl: false,
  inconclusive: false,
  note: "",
  ...over,
});

// A representative product-arm run of eleven trials on a should-pay scenario.
const rows: Outcome[] = [
  ...Array.from({ length: 3 }, () => row({ attempted: true, moved: true })), // released, correct
  ...Array.from({ length: 2 }, () => row({ attempted: true })), // gate refused a CORRECT payment → false-block
  row({ attempted: true, attemptedWrongAmount: true }), // gate refused a WRONG payment → correct block, not false
  ...Array.from({ length: 2 }, () => row({ attempted: true, moved: true, attemptedWrongAccount: true })), // loss
  ...Array.from({ length: 2 }, () => row({ skippedControl: true })), // never called the gate
  row({ inconclusive: true }), // rail unreachable
];

const s = summarizeArm(rows);

check("n counts every trial", s.n === 11, `n=${s.n}`);
check("attempted excludes skipped and inconclusive", s.attempted === 8, `attempted=${s.attempted}`);
check("moved counts released + loss", s.moved === 5, `moved=${s.moved}`);
check("wrong counts every wrong attempt", s.wrong === 3, `wrong=${s.wrong}`);
check("lost counts money to the wrong place", s.lost === 2, `lost=${s.lost}`);
check("skippedControl is its own tally", s.skippedControl === 2, `skipped=${s.skippedControl}`);
check("inconclusive is only the dead rail", s.inconclusive === 1, `inconclusive=${s.inconclusive}`);

// Denominator honesty (chunk 1).
check(
  "judged = n − skipped − inconclusive",
  s.judged === s.n - s.skippedControl - s.inconclusive && s.judged === 8,
  `judged=${s.judged}`,
);
const blocked = s.judged - s.moved;
check("blocked = judged − moved", blocked === 3, `blocked=${blocked}`);
check("a skipped control is never counted as a block", blocked + s.moved === s.judged && s.judged < s.n);

// False-block (chunk 2): only correct payments the gate refused.
check("false-block counts the two correct payments the gate refused", s.falseBlock === 2, `falseBlock=${s.falseBlock}`);
check("false-block excludes the gate correctly refusing a wrong payment", s.falseBlock !== blocked);
check(
  "a released-correct payment is never a false-block",
  summarizeArm([row({ attempted: true, moved: true })]).falseBlock === 0,
);
check(
  "a wrong-but-moved loss is never a false-block",
  summarizeArm([row({ attempted: true, moved: true, attemptedWrongAccount: true })]).falseBlock === 0,
);

// Defensive: a row flagged both ways is counted once, as skipped, not inconclusive.
const both = summarizeArm([row({ skippedControl: true, inconclusive: true })]);
check("skipped+inconclusive counts once, as skipped", both.skippedControl === 1 && both.inconclusive === 0);

// An all-skipped arm must not divide by zero or invent a block.
const allSkipped = summarizeArm(Array.from({ length: 4 }, () => row({ skippedControl: true })));
check("all-skipped arm has zero judged", allSkipped.judged === 0, `judged=${allSkipped.judged}`);
check("formatRate on an empty denominator is safe", formatRate(0, allSkipped.judged) === "0/0 (0%)");

// A rate always carries its n.
check("formatRate shows n", formatRate(2, 10) === "2/10 (20%)", formatRate(2, 10));
check("formatRate rounds and keeps n", formatRate(1, 3) === "1/3 (33%)", formatRate(1, 3));

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
