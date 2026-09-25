import { ISO_REJECT_CODES, ISO_REJECT_CODE_SET, ACCOUNT_BAD_CODES, describeIsoReject, isoReject } from "./iso20022.ts";

// The instant-rail reject catalog: complete for the codes we model, classified,
// and safe on unknowns. Deterministic; no network.
//
//   node src/reference/iso20022-selftest.ts

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

check("the catalog carries the credit-transfer reject set", ISO_REJECT_CODE_SET.length >= 12, `${ISO_REJECT_CODE_SET.length} codes`);
check("every code carries a meaning and guidance", ISO_REJECT_CODE_SET.every((c) => ISO_REJECT_CODES[c].meaning.length > 0 && ISO_REJECT_CODES[c].guidance.length > 0));

// The load-bearing bit: only AM04 (sender-side funds timing) could clear on resend.
check(
  "only AM04 could succeed on a resend",
  ISO_REJECT_CODE_SET.filter((c) => ISO_REJECT_CODES[c].resendCouldSucceed).join(",") === "AM04",
);
check(
  "the account-bad set is AC01/AC04/AC06/AG01",
  ACCOUNT_BAD_CODES.sort().join(",") === "AC01,AC04,AC06,AG01",
  ACCOUNT_BAD_CODES.join(","),
);
check("no account-bad code could succeed on a resend", ACCOUNT_BAD_CODES.every((c) => !ISO_REJECT_CODES[c].resendCouldSucceed));
check("account-bad guidance warns against taking new details from the reject", ACCOUNT_BAD_CODES.every((c) => /out.of.band|Escalate/i.test(ISO_REJECT_CODES[c].guidance)));

// Duplicates and regulatory rejections are their own categories, not account problems.
check("AM05 is classified duplicate", ISO_REJECT_CODES.AM05.category === "duplicate");
check("RR04 is classified regulatory", ISO_REJECT_CODES.RR04.category === "regulatory");
check("BE01 (name/account mismatch) is classified party", ISO_REJECT_CODES.BE01.category === "party");

// Lookups behave.
check("lookup is case-insensitive", isoReject("ac01")?.code === "AC01");
check("an unknown code is loud, non-retryable, and does not throw", describeIsoReject("ZZ99").resendCouldSucceed === false);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
