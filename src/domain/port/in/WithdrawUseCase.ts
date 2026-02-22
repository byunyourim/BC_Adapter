export interface WithdrawRequest {
  requestId: string;
  chain: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  token: string; // "ETH" 또는 ERC-20 컨트랙트 주소
}

export interface CheckWithdrawStatusRequest {
  requestId: string;
  chain: string;
  userOpHash: string;
}

export interface WithdrawUseCase {
  withdraw(req: WithdrawRequest): Promise<void>;
  checkStatus(req: CheckWithdrawStatusRequest): Promise<void>;
}
