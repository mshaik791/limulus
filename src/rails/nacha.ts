// The ACH return reasons the rail can produce, with the one distinction that
// changes what an agent should do next: whether re-sending to the SAME account
// could ever succeed. R01 is a timing problem — the account is fine, the funds
// were not there — so a later attempt can work. Every other code here means the
// account itself is wrong, closed, frozen or the debit was disowned, and
// re-sending to it is pointless at best and a second unauthorised entry at worst.
//
// A caller who answers a return with "use this new account instead" is the
// business-email-compromise pattern; a bad-account return is exactly when that
// call arrives, which is why the codes carry guidance and not just a label.
//
// Codes and meanings are Nacha's public return-reason taxonomy. Nothing here is
// invented; provenance is the published Nacha Operating Rules return codes.

export type NachaReturn = {
  code: string;
  name: string;
  /** Could re-sending the same entry to the same account ever succeed? Only R01. */
  retryableToSameAccount: boolean;
  guidance: string;
};

export const NACHA_RETURN_CODES: Record<string, NachaReturn> = {
  R01: {
    code: "R01",
    name: "Insufficient funds",
    retryableToSameAccount: true,
    guidance: "A timing problem, not a bad account. A later attempt may clear; nothing about the destination is wrong.",
  },
  R02: {
    code: "R02",
    name: "Account closed",
    retryableToSameAccount: false,
    guidance: "The account is closed. Do not resend. New details must come from the vendor out of band, not from the return.",
  },
  R03: {
    code: "R03",
    name: "No account / unable to locate account",
    retryableToSameAccount: false,
    guidance: "The account does not exist. A caller offering a 'new account' in response is the BEC pattern; verify out of band.",
  },
  R04: {
    code: "R04",
    name: "Invalid account number",
    retryableToSameAccount: false,
    guidance: "The account number is invalid. Correct it from a verified source, never from the returned entry or a follow-up call.",
  },
  R16: {
    code: "R16",
    name: "Account frozen / entry returned per OFAC",
    retryableToSameAccount: false,
    guidance: "The account is frozen, possibly under an OFAC action. Escalate to a person; do not resend.",
  },
  R29: {
    code: "R29",
    name: "Corporate customer advises not authorized",
    retryableToSameAccount: false,
    guidance: "The receiver says this debit was not authorised. Stop and escalate; resending is a second unauthorised entry.",
  },
};

/** The canonical codes the sandbox rail supports, for tests and scenario authors. */
export const NACHA_RETURN_CODE_SET = Object.keys(NACHA_RETURN_CODES);

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
    retryableToSameAccount: false,
    guidance: "Return reason not recognised. Treat as non-retryable and escalate.",
  };
