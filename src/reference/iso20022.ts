// ISO 20022 status/reject reason codes relevant to a pushed credit transfer
// (pacs.008 rejected or returned via pacs.002) — the instant-rail counterpart of
// the Nacha return catalog. RTP and FedNow carry ISO 20022 messaging, so these
// are the reject reasons an AP agent sees on those rails.
//
// Meanings transcribed 2026-09-23 from secondary references (ohmyfin.org
// reject-codes; validatefin.com pain.002 code list, both mirroring the ISO
// External Code Sets — ExternalStatusReason1Code). The primary source is the
// ISO 20022 External Code Sets spreadsheet, which is listed in
// research/VERIFY.md for a human to confirm against.
//
// The load-bearing bit, as with Nacha: whether re-sending the same payment to
// the same destination could ever succeed. Only AM04 (insufficient funds — a
// timing problem on the sending side) qualifies. Every account-status code
// means the destination is wrong, closed or blocked, and a caller offering a
// "new account" in response is the BEC pattern.

export type IsoRejectCategory =
  /** The destination account is wrong, closed or blocked. */
  | "account"
  /** Amount or limit problems. */
  | "amount"
  /** The bank believes this duplicates an earlier payment. */
  | "duplicate"
  /** Regulatory / compliance rejection. */
  | "regulatory"
  /** Party details do not match. */
  | "party"
  /** Message or format-level problems. */
  | "format";

export type IsoReject = {
  code: string;
  name: string;
  meaning: string;
  category: IsoRejectCategory;
  /** Could re-sending the same payment to the same destination ever succeed? AM04 only. */
  resendCouldSucceed: boolean;
  guidance: string;
};

const ACCOUNT_GUIDANCE =
  "The destination is wrong, closed or blocked. Do not resend. New details come from the vendor " +
  "record or out-of-band verification — never from the reject or a caller responding to it.";

const CATALOG: [string, string, string, IsoRejectCategory, boolean, string?][] = [
  ["AC01", "IncorrectAccountNumber", "The account number is incorrect or does not exist.", "account", false],
  ["AC04", "ClosedAccountNumber", "The account exists but has been closed.", "account", false],
  ["AC06", "BlockedAccount", "The account is blocked.", "account", false,
    "The account is blocked, possibly for compliance reasons. Escalate to a person; do not resend."],
  ["AG01", "TransactionForbidden", "The transaction is forbidden on this type of account.", "account", false],
  ["AG02", "InvalidBankOperationCode", "The transaction-type code is invalid for this corridor.", "format", false,
    "A message-level problem for the platform, not an agent decision. Escalate to the platform."],
  ["AM02", "NotAllowedAmount", "The amount exceeds an allowed limit.", "amount", false,
    "A limit on the receiving side. Splitting the payment to duck under it is structuring; escalate instead."],
  ["AM04", "InsufficientFunds", "Insufficient funds on the sending side.", "amount", true,
    "A funds-timing problem on our side. A later attempt may clear; nothing about the destination is wrong."],
  ["AM05", "Duplication", "The bank detected a duplicate of an earlier payment.", "duplicate", false,
    "The rail believes this payment already happened. Reconcile which one stands before any further submission."],
  ["BE01", "InconsistentWithEndCustomer", "End-customer details do not match the account holder.", "party", false,
    "The name and the account disagree — exactly the mismatch a redirected payment produces. Verify out of band."],
  ["RC01", "BankIdentifierIncorrect", "The bank identifier (BIC/routing) is incorrect.", "format", false,
    "Correct the identifier from a verified source, never from the reject or a follow-up call."],
  ["RR04", "RegulatoryReason", "Rejected for regulatory reasons.", "regulatory", false,
    "A regulatory rejection. Escalate to a person; do not resend or re-route."],
  ["FF01", "InvalidFileFormat", "The message format is invalid.", "format", false,
    "A message-level problem for the platform, not an agent decision."],
];

export const ISO_REJECT_CODES: Record<string, IsoReject> = Object.fromEntries(
  CATALOG.map(([code, name, meaning, category, resend, guidance]) => [
    code,
    {
      code, name, meaning, category, resendCouldSucceed: resend,
      guidance: guidance ?? (category === "account" ? ACCOUNT_GUIDANCE : meaning),
    },
  ]),
);

export const ISO_REJECT_CODE_SET = Object.keys(ISO_REJECT_CODES);

/** Codes meaning the destination account itself is bad — the BEC-bait rejects. */
export const ACCOUNT_BAD_CODES = CATALOG.filter(([, , , c]) => c === "account").map(([code]) => code);

export const isoReject = (code: string | undefined): IsoReject | undefined =>
  code ? ISO_REJECT_CODES[code.toUpperCase()] : undefined;

/** Always answers; an unrecognised code is treated as non-retryable. */
export const describeIsoReject = (code: string): IsoReject =>
  isoReject(code) ?? {
    code,
    name: "UnrecognisedReason",
    meaning: "Reject reason not recognised.",
    category: "format",
    resendCouldSucceed: false,
    guidance: "Reject reason not recognised. Treat as non-retryable and escalate.",
  };
