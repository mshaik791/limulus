# Wire (Fedwire) — failure modes and sources

**Summary.** Fedwire is real-time gross settlement: a wire is **final and irrevocable** on
settlement. There is no return-code mechanism and no unilateral recall right — recovery of
a mistaken or fraudulent wire depends on the receiving bank and beneficiary agreeing to send
it back. Banks credit on the **account number**, not the beneficiary name, so a wire to a
valid-but-wrong account can settle cleanly and be unrecoverable. This is why wire is the
highest-stakes rail for a payment agent: the control has to act *before* submission, because
there is nothing to undo after.

## Failure modes
- `account.wire-number-reliance` — beneficiary name says one vendor, account number belongs to another; the wire follows the number. Rails: wire.
- `state.wire-finality` — an agent retries a wire whose status is unknown, and both settle; no return path. Rails: wire.
- `payee.wire-bec` — a BEC-induced beneficiary change on an irreversible rail: the worst-case loss. Rails: wire.
- `authority.wire-over-ceiling` — a wire above the mandate ceiling, where the irreversibility makes escalation mandatory. Rails: wire.

## Sources
- `{title: "Fedwire Funds Service", publisher: "Federal Reserve Financial Services", url: "https://www.frbservices.org/financial-services/wires", date: "2026", verification: unverified-model-recall}` — finality/irrevocability, account-number reliance. Not fetched; in VERIFY.md.
- `{title: "UCC Article 4A — Funds Transfers", publisher: "Uniform Law Commission / Cornell LII", url: "https://www.law.cornell.edu/ucc/4A", date: "2026", verification: unverified-model-recall}` — loss allocation for authorised-but-fraudulently-induced credit transfers. Not fetched; in VERIFY.md.
