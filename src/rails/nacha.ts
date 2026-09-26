// The full published Nacha return-code catalog, with the classification that was
// missing from the first version of this file (see FINDINGS 2026-09-21): whether
// a code can occur on a pushed CREDIT at all.
//
// An AP agent paying a vendor originates a credit. The returns that can come
// back are the account/receiver ones (R02/R03/R04/R12/R14/R15/R16/R20/R23/R24/
// R31/R36). The authorization-dispute codes (R05/R07/R08/R10/R11/R29) and the
// funds-availability codes (R01/R09) are DEBIT return reasons — they arise when
// money is pulled, not pushed — and modelling one on a vendor credit is a
// modelling error, which the scenario validator now warns about.
//
// Codes, titles and windows transcribed from Modern Treasury's ACH Return Code
// Reference (fetched 2026-09-23), which mirrors the published Nacha set. Codes
// the source does not list (gaps in the numbering) are not invented here.
//
// One load-bearing bit per code: retryableToSameAccount. Only the two
// funds-timing codes (R01, R09 — both debit-side) could ever clear on a later
// attempt. No credit-relevant return is retryable to the same account: the
// account is closed, wrong, frozen, or the receiver refused. A caller offering
// a "new account" in response to one of those is the BEC pattern.

export type NachaClass =
  /** Can come back on a pushed vendor credit. The set an AP agent must handle. */
  | "credit"
  /** A debit-return reason; cannot occur on a pushed credit. */
  | "debit"
  /** File, format or network-level plumbing handled by the ODFI/platform. */
  | "format"
  /** ENR / RCK / XCK / dishonored-return machinery; not an agent decision. */
  | "other";

export type NachaReturn = {
  code: string;
  name: string;
  /** The published return timeframe. */
  window: string;
  class: NachaClass;
  /** Could re-sending the same entry to the same account ever succeed? R01/R09 only. */
  retryableToSameAccount: boolean;
  guidance: string;
};

const GUIDANCE: Record<NachaClass, string> = {
  credit:
    "This return ends the payment: the account or receiver rejected it. New details must come " +
    "from the vendor record or out-of-band verification — never from the return itself or a " +
    "caller responding to it; that is the BEC pattern.",
  debit:
    "A debit-return reason. It cannot occur on a pushed vendor credit; if it appears in a " +
    "credit flow, the model of the world is wrong, not the payment.",
  format:
    "A file, format or network-level return handled by the ODFI or platform. Not an agent " +
    "decision; escalate to the platform.",
  other:
    "Specialised return machinery (ENR, RCK, XCK, dishonored returns). Outside an AP agent's " +
    "decisions; escalate to the platform.",
};

/** code, name, window, class — guidance overrides only where the generic text is not enough. */
const CATALOG: [string, string, string, NachaClass, string?][] = [
  ["R01", "Insufficient funds", "2 banking days", "debit",
    "A funds-timing problem on a debit. A later attempt may clear; nothing about the destination is wrong."],
  ["R02", "Account closed", "2 banking days", "credit",
    "The account is closed. Do not resend. New details come from the vendor out of band, not from the return."],
  ["R03", "No account / unable to locate account", "2 banking days", "credit",
    "The account does not exist. A caller offering a 'new account' in response is the BEC pattern; verify out of band."],
  ["R04", "Invalid account number structure", "2 banking days", "credit",
    "The account number is malformed. Correct it from a verified source, never from the returned entry or a follow-up call."],
  ["R05", "Unauthorized consumer debit using corporate SEC code", "60 calendar days", "debit"],
  ["R06", "ODFI requested return", "undefined", "format"],
  ["R07", "Customer revoked authorization", "60 calendar days", "debit"],
  ["R08", "Payment stopped", "2 banking days", "debit"],
  ["R09", "Uncollected funds", "2 banking days", "debit",
    "Funds exist but are not yet collected. Like R01, a timing problem on a debit; a later attempt may clear."],
  ["R10", "Originator not known and/or not authorized to debit receiver's account", "60 calendar days", "debit"],
  ["R11", "Customer advises not within authorization terms", "60 calendar days", "debit"],
  ["R12", "Account sold to another DFI", "2 banking days", "credit"],
  ["R13", "Invalid ACH routing number", "next file delivery time", "format"],
  ["R14", "Representative payee deceased", "2 banking days", "credit"],
  ["R15", "Beneficiary / account holder deceased", "2 banking days", "credit"],
  ["R16", "Account frozen / returned per OFAC", "2 banking days", "credit",
    "The account is frozen, possibly under an OFAC action. Escalate to a person; do not resend."],
  ["R17", "File record edit criteria / suspicious entry with invalid account number", "2 banking days", "format"],
  ["R18", "Improper effective date", "next file delivery time", "format"],
  ["R19", "Amount field error", "next file delivery time", "format"],
  ["R20", "Non-transaction account", "2 banking days", "credit",
    "The account cannot accept entries. New details come from the vendor out of band."],
  ["R21", "Invalid company ID", "2 banking days", "format"],
  ["R22", "Invalid individual ID", "2 banking days", "format"],
  ["R23", "Receiver refused credit", "upon receipt of refusal", "credit",
    "The receiver refused the payment. Find out why from the vendor of record before anything else; do not resend unasked."],
  ["R24", "Duplicate entry", "2 banking days", "credit",
    "The RDFI saw this entry twice. Reconcile which one stands before any further submission."],
  ["R25", "Addenda error", "next file delivery time", "format"],
  ["R26", "Mandatory field error", "next file delivery time", "format"],
  ["R27", "Trace number error", "next file delivery time", "format"],
  ["R28", "Routing number check digit error", "next file delivery time", "format"],
  ["R29", "Corporate customer advises not authorized", "2 banking days", "debit",
    "The receiver says this DEBIT was not authorised. A debit-return reason; it cannot occur on a pushed vendor credit."],
  ["R30", "RDFI not in check truncation program", "next file delivery time", "other"],
  ["R31", "Permissible return (CCD and CTX only)", "undefined", "credit",
    "The RDFI returned a corporate entry with the ODFI's agreement. Reconcile with the vendor before anything else."],
  ["R32", "RDFI non-settlement", "next file delivery time", "format"],
  ["R33", "Return of XCK", "60 calendar days", "other"],
  ["R34", "Limited participation DFI", "next file delivery time", "format"],
  ["R35", "Improper debit", "next file delivery time", "debit"],
  ["R36", "Improper credit", "next file delivery time", "credit",
    "The credit itself was improper. Stop and reconcile; this is not an invitation to re-route it."],
  ["R37", "Source document presented", "60 calendar days", "debit"],
  ["R38", "Stop payment on source document", "60 calendar days", "debit"],
  ["R39", "Improper source document", "2 banking days", "debit"],
  ["R40", "Return of ENR", "n/a", "other"],
  ["R41", "Invalid transaction code (ENR)", "n/a", "other"],
  ["R42", "Routing number / check digit error (ENR)", "n/a", "other"],
  ["R43", "Invalid DFI account number (ENR)", "n/a", "other"],
  ["R44", "Invalid individual ID number (ENR)", "n/a", "other"],
  ["R45", "Invalid individual / company name (ENR)", "n/a", "other"],
  ["R46", "Invalid representative payee indicator (ENR)", "n/a", "other"],
  ["R47", "Duplicate enrollment (ENR)", "n/a", "other"],
  ["R50", "State law affecting RCK acceptance", "n/a", "other"],
  ["R51", "Ineligible / improper item related to RCK", "n/a", "other"],
  ["R52", "Stop payment on item related to RCK", "60 banking days", "other"],
  ["R53", "Item and RCK presented for payment", "60 calendar days", "other"],
  ["R61", "Misrouted return", "60 calendar days", "other"],
  ["R62", "Erroneous / reversing debit", "5 business days of return entry", "other"],
  ["R67", "Duplicate return", "n/a", "other"],
  ["R68", "Untimely return", "within 5 banking days", "other"],
  ["R69", "Field error", "within 5 banking days", "other"],
  ["R70", "Permissible return not accepted / not requested by ODFI", "within 5 banking days", "other"],
  ["R71", "Misrouted dishonored return", "within 5 banking days", "other"],
  ["R72", "Untimely dishonored return", "within 5 banking days", "other"],
  ["R73", "Timely original return", "within 5 banking days", "other"],
  ["R74", "Corrected return", "n/a", "other"],
  ["R75", "Return not duplicate", "within 5 banking days", "other"],
  ["R76", "No errors found", "contested within 2 banking days", "other"],
  ["R77", "Non-acceptance of R62", "contested within 2 banking days", "other"],
  ["R80", "IAT coding error", "contested within 2 banking days", "format"],
  ["R81", "Non-participant in IAT program", "contested within 2 banking days", "format"],
  ["R82", "Invalid foreign RDFI identification", "contested within 2 banking days", "format"],
  ["R83", "Foreign RDFI unable to settle", "contested within 2 banking days", "credit"],
  ["R84", "Not processed by gateway", "n/a", "format"],
  ["R85", "Incorrectly coded outbound international payment", "2 banking days", "format"],
];

const RETRYABLE = new Set(["R01", "R09"]);

export const NACHA_RETURN_CODES: Record<string, NachaReturn> = Object.fromEntries(
  CATALOG.map(([code, name, window, klass, guidance]) => [
    code,
    { code, name, window, class: klass, retryableToSameAccount: RETRYABLE.has(code), guidance: guidance ?? GUIDANCE[klass] },
  ]),
);

/** Every published code we model. */
export const NACHA_RETURN_CODE_SET = Object.keys(NACHA_RETURN_CODES);

/** The set an AP agent paying vendors must actually handle: returns of a pushed credit. */
export const CREDIT_RETURN_CODES = CATALOG.filter(([, , , k]) => k === "credit").map(([c]) => c);

/** Look up a code, or undefined if it is not one we model. Case-insensitive. */
export const nachaReturn = (code: string | undefined): NachaReturn | undefined =>
  code ? NACHA_RETURN_CODES[code.toUpperCase()] : undefined;

/**
 * Always returns a description. An unrecognised code is treated as
 * non-retryable, because guessing "safe to resend" on a code we do not model is
 * the expensive direction to be wrong in.
 */
export const describeReturn = (code: string): NachaReturn =>
  nachaReturn(code) ?? {
    code,
    name: "Unrecognised return code",
    window: "unknown",
    class: "other",
    retryableToSameAccount: false,
    guidance: "Return reason not recognised. Treat as non-retryable and escalate.",
  };
