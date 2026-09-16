import { randomBytes, randomUUID } from "node:crypto";

// The Increase adapter. This is the piece that turns "we hold the payment at
// the bank" from a claim into something you can watch happen.
//
// The sequence Increase supports, and the reason this works at all:
//
//   1. The agent creates an ACH transfer with require_approval: true.
//      It lands in pending_approval. No money has moved and none will.
//   2. Limulus runs the three-way match against what the agent declared.
//   3. ALLOW  -> POST /ach_transfers/{id}/approve, and it goes to the rail.
//      BLOCK  -> POST /ach_transfers/{id}/cancel, and it never does.
//      ESCALATE or WAIT -> leave it sitting in pending_approval.
//
// The control point is the approval, not a suggestion the agent may ignore. An
// unapproved transfer expires rather than settles, so failing closed is the
// default rather than something we have to enforce.
//
// API shape verified against increase.com/documentation/api/ach-transfers:
//   base        https://sandbox.increase.com  (production: https://api.increase.com)
//   auth        Authorization: Bearer <key>
//   idempotency Idempotency-Key: <uuid>
//   create      POST /ach_transfers   {account_id, amount (USD cents),
//                 statement_descriptor, external_account_id | routing_number +
//                 account_number + funding, individual_name, require_approval}
//   approve     POST /ach_transfers/{id}/approve
//   cancel      POST /ach_transfers/{id}/cancel

export const SANDBOX_BASE = "https://sandbox.increase.com";
export const PRODUCTION_BASE = "https://api.increase.com";

/** Increase's ACH transfer lifecycle, as documented. */
export type IncreaseStatus =
  | "pending_approval"
  | "pending_transfer_session_confirmation"
  | "canceled"
  | "pending_submission"
  | "pending_reviewing"
  | "requires_attention"
  | "rejected"
  | "submitted"
  | "returned";

export type IncreaseTransfer = {
  id: string;
  status: IncreaseStatus;
  /** USD cents. */
  amount: number;
  currency: string;
  account_id: string;
  external_account_id?: string;
  routing_number?: string;
  account_number?: string;
  individual_name?: string;
  statement_descriptor: string;
  approval: { approved_at: string; approved_by: string | null } | null;
  cancellation?: { canceled_at: string } | null;
  created_at: string;
};

export type CreateTransferInput = {
  accountId: string;
  /** Whole currency units. Converted to cents here, in one place. */
  amount: number;
  statementDescriptor: string;
  externalAccountId?: string;
  routingNumber?: string;
  accountNumber?: string;
  individualName?: string;
  idempotencyKey?: string;
};

export type RailMode = "sandbox" | "production" | "simulated";

export interface Rail {
  readonly mode: RailMode;
  readonly name: string;
  create(input: CreateTransferInput): Promise<IncreaseTransfer>;
  approve(id: string): Promise<IncreaseTransfer>;
  cancel(id: string): Promise<IncreaseTransfer>;
  get(id: string): Promise<IncreaseTransfer>;
}

const toCents = (amount: number) => Math.round(amount * 100);

class IncreaseApi implements Rail {
  readonly mode: RailMode;
  readonly name = "increase";
  private base: string;
  private key: string;

  constructor(key: string, mode: "sandbox" | "production") {
    this.key = key;
    this.mode = mode;
    this.base = mode === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
  }

  private async request(path: string, body?: unknown, idempotencyKey?: string): Promise<IncreaseTransfer> {
    const response = await fetch(`${this.base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await response.text();
    if (!response.ok) {
      // Increase returns a structured error; surface it rather than a status code.
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.title ?? parsed.detail ?? text;
      } catch {}
      throw new Error(`Increase ${response.status} on ${path}: ${detail}`);
    }
    return JSON.parse(text) as IncreaseTransfer;
  }

  create(input: CreateTransferInput) {
    return this.request(
      "/ach_transfers",
      {
        account_id: input.accountId,
        amount: toCents(input.amount),
        statement_descriptor: input.statementDescriptor,
        ...(input.externalAccountId
          ? { external_account_id: input.externalAccountId }
          : {
              routing_number: input.routingNumber,
              account_number: input.accountNumber,
              funding: "checking",
            }),
        ...(input.individualName ? { individual_name: input.individualName } : {}),
        // The whole point. Without this the transfer goes straight to the rail
        // and there is nothing left to gate.
        require_approval: true,
      },
      input.idempotencyKey ?? randomUUID(),
    );
  }

  approve = (id: string) => this.request(`/ach_transfers/${id}/approve`, {});
  cancel = (id: string) => this.request(`/ach_transfers/${id}/cancel`, {});
  get = (id: string) => this.request(`/ach_transfers/${id}`);
}

/**
 * A local stand-in that follows the same lifecycle, so the gate can be
 * demonstrated and tested without credentials. It is deliberately not a
 * pretend bank: it holds state and enforces the transitions Increase enforces,
 * and nothing else.
 */
export class SimulatedRail implements Rail {
  readonly mode: RailMode = "simulated";
  readonly name = "increase-simulated";
  private transfers = new Map<string, IncreaseTransfer>();

  async create(input: CreateTransferInput): Promise<IncreaseTransfer> {
    const transfer: IncreaseTransfer = {
      id: `ach_transfer_${randomBytes(10).toString("hex")}`,
      status: "pending_approval",
      amount: toCents(input.amount),
      currency: "USD",
      account_id: input.accountId,
      external_account_id: input.externalAccountId,
      routing_number: input.routingNumber,
      account_number: input.accountNumber,
      individual_name: input.individualName,
      statement_descriptor: input.statementDescriptor,
      approval: null,
      cancellation: null,
      created_at: new Date().toISOString(),
    };
    this.transfers.set(transfer.id, transfer);
    return transfer;
  }

  async approve(id: string): Promise<IncreaseTransfer> {
    const transfer = this.must(id);
    if (transfer.status !== "pending_approval") {
      throw new Error(`Cannot approve a transfer in ${transfer.status}`);
    }
    transfer.approval = { approved_at: new Date().toISOString(), approved_by: "limulus" };
    transfer.status = "pending_submission";
    return transfer;
  }

  async cancel(id: string): Promise<IncreaseTransfer> {
    const transfer = this.must(id);
    if (transfer.status !== "pending_approval") {
      throw new Error(`Cannot cancel a transfer in ${transfer.status}`);
    }
    transfer.cancellation = { canceled_at: new Date().toISOString() };
    transfer.status = "canceled";
    return transfer;
  }

  async get(id: string): Promise<IncreaseTransfer> {
    return this.must(id);
  }

  private must(id: string): IncreaseTransfer {
    const transfer = this.transfers.get(id);
    if (!transfer) throw new Error(`No transfer ${id}`);
    return transfer;
  }
}

/**
 * Real rail when a key is present, simulated otherwise. The mode is reported
 * everywhere it is used, so a demo can never quietly look like a live one.
 */
export function rail(): Rail {
  const key = process.env.INCREASE_API_KEY;
  if (!key) return new SimulatedRail();
  const mode = process.env.INCREASE_ENV === "production" ? "production" : "sandbox";
  return new IncreaseApi(key, mode);
}

/** What a transfer's status means for whether money can still be stopped. */
export function stoppable(status: IncreaseStatus): boolean {
  return status === "pending_approval";
}
