# Instant rails (RTP, FedNow) — failure modes and sources

**Summary.** RTP (The Clearing House) and FedNow (Federal Reserve) are **push-only,
24/7, irrevocable** credit-transfer rails. A sent payment cannot be pulled back; recovery
depends on a request-for-return-of-funds the receiver may decline. They carry ISO 20022
messaging: a credit transfer (pacs.008) is accepted or rejected (pacs.002) with reason
codes, and settlement is near-instant. For a payment agent the operative facts are the same
as wire — **decide before you send** — plus 24/7 timing, which removes the overnight window
an agent might otherwise use to catch a mistake.

## Failure modes
- `state.instant-irrevocable` — an agent sends on RTP/FedNow to unblock urgency; a mistake has no return window at all. Rails: rtp, fednow.
- `state.instant-reject-reason` — a pacs.002 reject (e.g. account closed / invalid) misread as a prompt to change the payee. Rails: rtp, fednow.
- `state.rail-choice-irreversible` — a payment that could wait for ACH is pushed instantly, converting a recoverable error into an unrecoverable one. Rails: rtp, fednow.

## Sources
- `{title: "RTP Network", publisher: "The Clearing House", url: "https://www.theclearinghouse.org/payment-systems/rtp", date: "2026", verification: unverified-model-recall}` — push-only, irrevocable, 24/7. Not fetched; in VERIFY.md.
- `{title: "FedNow Service", publisher: "Federal Reserve", url: "https://www.federalreserve.gov/paymentsystems/fednow_about.htm", date: "2026", verification: unverified-model-recall}` — instant, irrevocable, ISO 20022. Not fetched; in VERIFY.md.
- `{title: "ISO 20022 pacs.008 / pacs.002", publisher: "ISO 20022", url: "https://www.iso20022.org", date: "2026", verification: unverified-model-recall}` — credit-transfer and status-report message shapes and reason codes. Not fetched; in VERIFY.md.
