import { UserOperation } from "../../model/UserOperation";

export interface UserOperationReceipt {
  userOpHash: string;
  success: boolean;
  actualGasCost: string;
  actualGasUsed: string;
  txHash: string; // 실제 온체인 트랜잭션 해시
}

export interface BundlerPort {
  buildUserOperation(params: {
    chain: string;
    sender: string;
    toAddress: string;
    amount: string;
    token: string;
    ownerAddress: string;
    salt: string;
  }): Promise<{ userOp: UserOperation; userOpHash: string }>;

  sendUserOperation(chain: string, userOp: UserOperation): Promise<string>; // userOpHash

  getUserOperationReceipt(
    chain: string,
    userOpHash: string,
  ): Promise<UserOperationReceipt | null>;
}
