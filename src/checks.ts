import type {
  Authorization,
  CheckResult,
  Declaration,
  Document,
  PaymentOrder,
} from "./types.ts";

/** Phrases that should never appear in a document an agent acts on. */
const INSTRUCTION_PATTERNS: RegExp[] = [
  /remit(?:tance)?\s+to\s+(?:a\s+)?new\s+account/i,
  /(?:updated?|changed?|new)\s+bank(?:ing)?\s+(?:details|account)/i,
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  /pay\s+immediately\s+to/i,
  /do\s+not\s+verify/i,
  /account\s+ending\s+\d{4}/i,
];

const money = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** Days since an ISO date. */
function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/**
 * Three-way match plus fraud checks. Every check returns a result so the
 * record shows what ran, including the ones that passed.
 */
export function runChecks(
  authorization: Authorization,
  declaration: Declaration,
  paymentOrder: PaymentOrder,
  documents: Document[],
  previousInvoiceIds: Set<string>,
): CheckResult[] {
  const checks: CheckResult[] = [];
  const vendor = authorization.approvedVendors.find(
    (v) => v.name.toLowerCase() === declaration.payeeName.toLowerCase(),
  );
  const approvedInvoice = authorization.approvedInvoices.find(
    (i) => i.invoiceId === declaration.invoiceId,
  );

  // 1. Authorization vs declaration: is this vendor allowed at all?
  checks.push(
    vendor
      ? {
          id: "vendor_approved",
          name: "Vendor is on the approved list",
          status: "pass",
          detail: `${vendor.name} (${vendor.vendorId})`,
        }
      : {
          id: "vendor_approved",
          name: "Vendor is on the approved list",
          status: "fail",
          detail: `${declaration.payeeName} is not in policy ${authorization.policyVersion}`,
        },
  );

  // 2. Authorization vs declaration: within the per-payment limit?
  checks.push(
    declaration.amount <= authorization.limitPerPayment
      ? {
          id: "within_limit",
          name: "Within the per-payment limit",
          status: "pass",
          detail: `${money(declaration.amount, declaration.currency)} of ${money(
            authorization.limitPerPayment,
            authorization.currency,
          )}`,
        }
      : {
          id: "within_limit",
          name: "Within the per-payment limit",
          status: "fail",
          detail: `${money(declaration.amount, declaration.currency)} exceeds ${money(
            authorization.limitPerPayment,
            authorization.currency,
          )}`,
        },
  );

  // 3. Authorization vs declaration: did a person approve this invoice?
  if (!approvedInvoice) {
    checks.push({
      id: "invoice_approved",
      name: "Invoice approved by a person",
      status: "fail",
      detail: `No approval on file for ${declaration.invoiceId}`,
    });
  } else if (Math.abs(approvedInvoice.amount - declaration.amount) > 0.005) {
    checks.push({
      id: "invoice_approved",
      name: "Invoice approved by a person",
      status: "fail",
      detail: `Approved ${money(approvedInvoice.amount, authorization.currency)}, declared ${money(
        declaration.amount,
        declaration.currency,
      )}`,
    });
  } else {
    checks.push({
      id: "invoice_approved",
      name: "Invoice approved by a person",
      status: "pass",
      detail: `${declaration.invoiceId} approved by ${approvedInvoice.approvedBy}`,
    });
  }

  // 4. Declaration vs payment order: the heart of the three-way match.
  const mismatches: string[] = [];
  if (declaration.payeeAccountLast4 !== paymentOrder.payeeAccountLast4) {
    mismatches.push(
      `account ****${declaration.payeeAccountLast4} declared, ****${paymentOrder.payeeAccountLast4} in the payment order`,
    );
  }
  if (Math.abs(declaration.amount - paymentOrder.amount) > 0.005) {
    mismatches.push(
      `${money(declaration.amount, declaration.currency)} declared, ${money(
        paymentOrder.amount,
        paymentOrder.currency,
      )} in the payment order`,
    );
  }
  if (declaration.payeeName.toLowerCase() !== paymentOrder.payeeName.toLowerCase()) {
    mismatches.push(`payee ${declaration.payeeName} declared, ${paymentOrder.payeeName} in the payment order`);
  }
  if (!paymentOrder.reference.includes(declaration.invoiceId)) {
    mismatches.push(`reference ${paymentOrder.reference} does not carry ${declaration.invoiceId}`);
  }
  checks.push(
    mismatches.length === 0
      ? {
          id: "declaration_matches_order",
          name: "Payment order matches the declaration",
          status: "pass",
          detail: `payee, amount, account and reference agree`,
        }
      : {
          id: "declaration_matches_order",
          name: "Payment order matches the declaration",
          status: "fail",
          detail: mismatches.join("; "),
        },
  );

  // 5. Payee account against the vendor master record.
  if (!vendor) {
    checks.push({
      id: "payee_account",
      name: "Account matches the vendor record",
      status: "skip",
      detail: "No vendor record to compare against",
    });
  } else if (vendor.accountLast4 !== paymentOrder.payeeAccountLast4) {
    checks.push({
      id: "payee_account",
      name: "Account matches the vendor record",
      status: "fail",
      detail: `vendor record ****${vendor.accountLast4}, payment order ****${paymentOrder.payeeAccountLast4}`,
    });
  } else {
    checks.push({
      id: "payee_account",
      name: "Account matches the vendor record",
      status: "pass",
      detail: `****${vendor.accountLast4}`,
    });
  }

  // 6. Recent bank detail change on the vendor record.
  if (vendor) {
    const age = daysSince(vendor.bankDetailsUpdated);
    checks.push(
      age <= 30
        ? {
            id: "bank_detail_change",
            name: "No recent bank detail change",
            status: "review",
            detail: `vendor bank details changed ${age} day(s) ago; callback to ${
              vendor.callbackPhone ?? "the number on file"
            } required`,
          }
        : {
            id: "bank_detail_change",
            name: "No recent bank detail change",
            status: "pass",
            detail: `last changed ${age} day(s) ago`,
          },
    );
  }

  // 7. Duplicate payment.
  checks.push(
    previousInvoiceIds.has(declaration.invoiceId)
      ? {
          id: "duplicate",
          name: "Not a duplicate payment",
          status: "fail",
          detail: `${declaration.invoiceId} was already paid`,
        }
      : {
          id: "duplicate",
          name: "Not a duplicate payment",
          status: "pass",
          detail: `${declaration.invoiceId} has not been paid`,
        },
  );

  // 8. Hidden or embedded instructions in any document the agent read.
  const findings: string[] = [];
  for (const doc of documents) {
    const haystacks: [string, string][] = [
      ["visible text", doc.text ?? ""],
      ["hidden text", doc.hiddenText ?? ""],
    ];
    for (const [where, text] of haystacks) {
      for (const pattern of INSTRUCTION_PATTERNS) {
        const found = text.match(pattern);
        if (found) findings.push(`${doc.name} (${where}): "${found[0]}"`);
      }
    }
    if (doc.hiddenText && doc.hiddenText.trim().length > 0 && findings.length === 0) {
      findings.push(`${doc.name}: contains text that is not visible when rendered`);
    }
  }
  checks.push(
    findings.length === 0
      ? {
          id: "embedded_instructions",
          name: "No embedded payment instructions",
          status: "pass",
          detail: `${documents.length} document(s) scanned`,
        }
      : {
          id: "embedded_instructions",
          name: "No embedded payment instructions",
          status: "fail",
          detail: findings.join("; "),
        },
  );

  // 9. The declaration must cite the documents it relied on.
  checks.push(
    declaration.sources.length > 0
      ? {
          id: "sources_cited",
          name: "Declaration cites its source documents",
          status: "pass",
          detail: declaration.sources.map((s) => s.name).join(", "),
        }
      : {
          id: "sources_cited",
          name: "Declaration cites its source documents",
          status: "review",
          detail: "The agent did not cite any documents",
        },
  );

  return checks;
}
