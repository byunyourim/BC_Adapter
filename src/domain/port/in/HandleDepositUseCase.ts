export interface DepositEvent {
  txHash: string;
  toAddress: string;
  amount: string;
  chain: string;
}

export interface HandleDepositUseCase {
  handleDeposit(event: DepositEvent): Promise<void>;
}
