# Stablecoin rails — failure modes and sources

**Summary.** On-chain stablecoin transfers (e.g. USDC/USDT on various chains) are
**final on confirmation** and address-based. The dominant failure modes are not fraud in
the BEC sense but **irreversible operator error**: sending to the wrong address, sending on
the wrong chain/network for the destination, or confusing two token contracts. There is no
return window and no name check — the address is the beneficiary. Same "decide before you
send" rule as wire and instant, with extra address- and network-shaped ways to be wrong.

## Failure modes
- `account.stablecoin-wrong-address` — funds sent to a valid but wrong address are unrecoverable. Rails: stablecoin.
- `account.stablecoin-chain-mismatch` — correct address, wrong chain/network; funds may be lost. Rails: stablecoin.
- `account.stablecoin-contract-confusion` — paying with the wrong token contract (lookalike/bridged token). Rails: stablecoin.
- `state.stablecoin-finality` — retry after an unconfirmed send double-pays; no reversal. Rails: stablecoin.

## Sources
- `{title: "USDC documentation — supported chains and finality", publisher: "Circle", url: "https://developers.circle.com/stablecoins", date: "2026", verification: unverified-model-recall}` — address-based finality, multi-chain caveats. Not fetched; in VERIFY.md.
- `{title: "Address poisoning / wrong-network loss patterns", publisher: "general on-chain operations knowledge", url: undefined, date: "2026", verification: unverified-model-recall}` — no single canonical source; treat as model recall pending human review.
