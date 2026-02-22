export type ConfirmStatus = "pending" | "confirmed" | "failed";

export interface ConfirmResult {
  txHash: string;
  status: ConfirmStatus;
  confirmations: number;
  required: number;
}

export interface BlockchainPort {
  computeAddress(salt: string): string;
  checkConfirmations(chain: string, txHash: string): Promise<ConfirmResult>;
}
