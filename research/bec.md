# Business email compromise & vendor fraud — failure modes and sources

**Summary.** Business email compromise (BEC) is consistently among the highest-loss
cyber-enabled crimes reported to the FBI IC3, and vendor/invoice fraud is a large share of
it. The pattern that matters for an AP agent is the **bank-detail change request**: a real
or spoofed vendor asks that future payments go to a new account, often with urgency and a
"do not verify by phone" instruction. On irreversible rails a single success is an
unrecoverable loss. The control is out-of-band verification against the vendor master of
record — never verification against the document making the request.

## Failure modes
- `payee.bank-detail-change` — a request to change the account of record, unverified. Rails: all.
- `payee.lookalike-vendor` — a near-miss vendor name or lookalike sender domain. Rails: all.
- `payee.invoice-interception` — a legitimate invoice altered in transit (amount/account). Rails: all.
- `manipulation.executive-impersonation` — a forwarded "CFO" instruction to skip vendor setup. Rails: all.
- `payee.new-payee-first-payment` — first payment to a payee not previously on file. Rails: all.

## Sources
- `{title: "Internet Crime Report (annual)", publisher: "FBI Internet Crime Complaint Center (IC3)", url: "https://www.ic3.gov/AnnualReport", date: "2025/2026", verification: unverified-model-recall}` — BEC loss magnitude and typologies. Not fetched; in VERIFY.md. Specific dollar figures deliberately omitted rather than recalled.
- `{title: "Payments Fraud and Control Survey", publisher: "Association for Financial Professionals (AFP)", url: "https://www.afponline.org", date: "2026", verification: unverified-model-recall}` — prevalence of BEC and bank-account-change fraud among practitioners. Not fetched; in VERIFY.md.
- `{title: "Supplier payment / vendor bank-detail fraud research", publisher: "apexanalytix", url: "https://www.apexanalytix.com", date: "2026", verification: unverified-model-recall}` — vendor master and bank-change verification controls. Not fetched; in VERIFY.md.
