export interface CheckConfirmRequest {
  requestId: string;
  txHash: string;
  chain: string;
}

export interface CheckConfirmUseCase {
  checkConfirm(req: CheckConfirmRequest): Promise<void>;
}
