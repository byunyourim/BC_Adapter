import { computeAddress } from "ethers";
import {
  WithdrawUseCase,
  WithdrawRequest,
  CheckWithdrawStatusRequest,
} from "../domain/port/in/WithdrawUseCase";
import { AccountRepository } from "../domain/port/out/AccountRepository";
import { BundlerPort } from "../domain/port/out/BundlerPort";
import { KmsPort } from "../domain/port/out/KmsPort";
import { MessagePublisher } from "../domain/port/out/MessagePublisher";

export class WithdrawService implements WithdrawUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly bundler: BundlerPort,
    private readonly kms: KmsPort,
    private readonly publisher: MessagePublisher,
  ) {}

  async withdraw(req: WithdrawRequest): Promise<void> {
    const { requestId, chain, fromAddress, toAddress, amount, token } = req;

    try {
      // 1. 계정 존재 확인
      const account = await this.accountRepo.findByAddress(fromAddress);
      if (!account) {
        throw new Error(`Account not found: ${fromAddress}`);
      }

      // 2. KMS에서 owner 주소 유도
      const signingKey = await this.kms.getSigningKey();
      const ownerAddress = computeAddress(signingKey);

      // 3. UserOperation 빌드
      const { userOp, userOpHash } = await this.bundler.buildUserOperation({
        chain,
        sender: fromAddress,
        toAddress,
        amount,
        token,
        ownerAddress,
        salt: account.salt,
      });

      // 4. KMS로 서명
      const signature = await this.kms.sign(userOpHash);
      userOp.signature = signature;

      // 5. 번들러에 전송
      const sentHash = await this.bundler.sendUserOperation(chain, userOp);

      console.log(`[Withdraw] Sent UserOp: ${sentHash} for request ${requestId}`);

      // 6. 전송 결과 발행
      await this.publisher.publish("adapter.withdraw.sent", {
        requestId,
        chain,
        fromAddress,
        toAddress,
        amount,
        token,
        userOpHash: sentHash,
      });
    } catch (err) {
      console.error("[Withdraw] Failed:", err);
      await this.publisher.publish("adapter.withdraw.sent", {
        requestId,
        error: (err as Error).message,
      });
    }
  }

  async checkStatus(req: CheckWithdrawStatusRequest): Promise<void> {
    const { requestId, chain, userOpHash } = req;

    try {
      const receipt = await this.bundler.getUserOperationReceipt(chain, userOpHash);

      if (!receipt) {
        console.log(`[Withdraw] Receipt not found yet: ${userOpHash}`);
        await this.publisher.publish("adapter.withdraw.confirmed", {
          requestId,
          userOpHash,
          status: "pending",
        });
        return;
      }

      console.log(
        `[Withdraw] Status: ${userOpHash} -> ${receipt.success ? "success" : "failed"}, tx: ${receipt.txHash}`,
      );

      await this.publisher.publish("adapter.withdraw.confirmed", {
        requestId,
        userOpHash,
        success: receipt.success,
        txHash: receipt.txHash,
        actualGasCost: receipt.actualGasCost,
        actualGasUsed: receipt.actualGasUsed,
      });
    } catch (err) {
      console.error("[Withdraw] Status check failed:", err);
      await this.publisher.publish("adapter.withdraw.confirmed", {
        requestId,
        userOpHash,
        status: "failed",
        error: (err as Error).message,
      });
    }
  }
}
