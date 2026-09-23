import { evaluateShadow, readShadow, reviewShadow, shadowSummary, verifyShadowChain, verifyShadowRecord } from "./shadow.ts";
import { readEvents } from "./monitor.ts";
import { scenarios } from "./scenarios.ts";

// Shadow mode is only worth trusting if it says "would have", never "did",
// keeps its own history, and can be reviewed without breaking its seal.
//
//   node src/shadow-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// Each selftest run uses its own org, so the history it builds is its own.
const org = `selftest-${Date.now().toString(36)}`;
const before = readShadow().length;
const eventsBefore = readEvents().length;

const clean = scenarios.clean.request;
const poisoned = scenarios.poisoned.request;
const overlimit = scenarios.overlimit.request;

// 1. Production released a clean payment; so would we.
const a = evaluateShadow({ org, agentId: "ap-agent", ...clean, production: { outcome: "released", reference: "prod-1" } });
check("a clean payment production released: agree", a.agreement === "agree" && a.wouldHave === "released", `${a.agreement}/${a.wouldHave}`);
check("no exposure on agreement", a.exposure === null);

// 2. Production released a poisoned payment; we would have held it.
const b = evaluateShadow({ org, agentId: "ap-agent", ...poisoned, production: { outcome: "released", reference: "prod-2" } });
check("a poisoned payment production released: would have held", b.agreement === "would_have_held", `${b.agreement}/${b.wouldHave}`);
check("exposure is the production amount, reported as what we would have stopped", b.exposure === poisoned.paymentOrder.amount);
check("the reasons name the check that failed", b.reasons.some((r) => /hidden|instruction/i.test(r)), b.reasons.join(" | "));

// 3. Production held an over-limit payment; so would we.
const c = evaluateShadow({ org, agentId: "ap-agent", ...overlimit, production: { outcome: "held", reference: "prod-3" } });
check("an over-limit payment production held: agree", c.agreement === "agree" && c.wouldHave !== "released");

// 4. History: the clean invoice released in (1) is now a duplicate.
const d = evaluateShadow({ org, agentId: "ap-agent", ...clean, production: { outcome: "released", reference: "prod-4" } });
check("the same invoice released again: would have held as a duplicate, from shadow's own history", d.agreement === "would_have_held" && d.checks.some((x) => x.id === "duplicate" && x.status === "fail"), `${d.agreement}`);

// 5. A different org does not see that history.
const e = evaluateShadow({ org: `${org}-other`, agentId: "ap-agent", ...clean, production: { outcome: "released" } });
check("another org's first payment of that invoice is not a duplicate", e.agreement === "agree", e.agreement);

// 6. Production stopped something we would have released. A fresh org, so the
// clean invoice has no history here and nothing but production's own caution
// stands in the way.
const f = evaluateShadow({ org: `${org}-third`, agentId: "ap-agent", ...clean, production: { outcome: "held" } });
check("production held what we would release: would_have_released, no exposure", f.agreement === "would_have_released" && f.exposure === null, f.agreement);

// Sealing and chain.
check("records verify", [a, b, c, d, e, f].every((r) => verifyShadowRecord(r).ok));
const chain = verifyShadowChain();
check("the shadow chain verifies end to end", chain.ok, chain.problems.slice(0, 2).map((p) => p.problem).join("; "));
check("six records were appended", readShadow().length === before + 6);

// Review does not break the seal.
const reviewed = reviewShadow(b.id, "confirmed", "Vendor confirmed by phone that no bank change was requested.");
check("a review is recorded", reviewed?.review?.verdict === "confirmed");
check("and the reviewed record still verifies", reviewed ? verifyShadowRecord(reviewed).ok : false);
let threw = false;
try {
  reviewShadow(d.id, "false_positive", "");
} catch {
  threw = true;
}
check("a review without a note is refused", threw);
reviewShadow(d.id, "false_positive", "The first payment was reversed before this one; not a duplicate.");

// Summary: every rate with its n, and the wording never claims we held anything.
const s = shadowSummary(org);
check("summary counts", s.evaluated === 4 && s.agreed.value === 2 && s.wouldHaveHeld.value === 2 && s.wouldHaveReleased.value === 0, JSON.stringify({ e: s.evaluated, a: s.agreed, h: s.wouldHaveHeld, r: s.wouldHaveReleased }));
const s3 = shadowSummary(`${org}-third`);
check("the third org's summary shows the would-have-released case", s3.evaluated === 1 && s3.wouldHaveReleased.value === 1 && s3.exposureWeWouldHaveStopped.payments === 0);
check("every count carries its denominator", [s.agreed, s.wouldHaveHeld, s.wouldHaveEscalated, s.wouldHaveReleased].every((x) => x.of === s.evaluated));
check("exposure sums the production amounts we would have stopped", s.exposureWeWouldHaveStopped.amount === poisoned.paymentOrder.amount + clean.paymentOrder.amount && s.exposureWeWouldHaveStopped.payments === 2);
check("false-positive rate is over reviewed disagreements only", s.falsePositiveRate?.value === 1 && s.falsePositiveRate.of === 2);
check("the note says shadow observes and never held anything", /observes/.test(s.note) && /Nothing here held/.test(s.note));
check("top checks are listed", s.topChecks.length > 0 && s.topChecks[0].count >= 1);

// Monitor integration: shape, not values.
const events = readEvents().slice(eventsBefore);
check("each shadow decision produced a monitor event", events.filter((ev) => ev.type === "shadow_decision").length === 6);
check("the event carries no amount", events.every((ev) => !("amount" in ev.payload) && !JSON.stringify(ev.payload).includes(String(poisoned.paymentOrder.amount))));

// Tamper.
const tampered = { ...b, wouldHave: "released" as const };
check("flipping our answer breaks verification", !verifyShadowRecord(tampered).ok);

console.log("");
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All shadow-mode checks passed");
