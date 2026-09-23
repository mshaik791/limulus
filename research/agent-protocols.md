# Agent payment protocols — what they verify, and what they do not

**Summary.** A wave of agent-payment protocols and programs establishes *authorisation* —
that a given agent was permitted to transact on a user's or business's behalf, within a
mandate. None of them establishes **correctness**: that this specific payment is to the right
payee, for the right amount, and not a duplicate. That gap is Limulus's position. An
authorised agent acting on a poisoned invoice is authorised and wrong; the mandate says it
*may* pay, not that it *should* pay *this*.

| Protocol / program | Verifies (roughly) | Does not verify |
|---|---|---|
| AP2 (Agent Payments Protocol) | Mandates: a signed, delegated authorisation from a human to an agent, with scope. | Whether a given payment is correct, non-duplicate, to the right account. |
| Stripe / Mastercard / Visa agent programs | Agent identity, tokenised credentials, network authorisation. | Payment correctness against the AP context (PO, vendor master, prior settlements). |
| x402 | Programmatic pay-per-use authorisation over HTTP (402 flow). | AP correctness; it is an authorisation/settlement rail, not a check. |

**Implication.** Limulus's Protect is complementary, not competitive: it consumes an
authorisation (mandate) and adds the deterministic correctness check the protocols leave out.
This is why the intent record (workstream C) references the mandate ID rather than replacing it.

## Sources
- `{title: "Agent Payments Protocol (AP2)", publisher: "Google", url: "https://cloud.google.com/blog", date: "2026", verification: unverified-model-recall}` — mandate model. Not fetched; exact URL and scope must be human-verified. In VERIFY.md.
- `{title: "Agentic commerce / agent payment programs", publisher: "Stripe, Mastercard, Visa (respective announcements)", url: undefined, date: "2026", verification: unverified-model-recall}` — no single canonical source; individual program docs must be human-verified. In VERIFY.md.
- `{title: "x402 protocol", publisher: "x402 (open spec)", url: "https://www.x402.org", date: "2026", verification: unverified-model-recall}` — HTTP 402 pay-per-use flow. Not fetched; in VERIFY.md.
