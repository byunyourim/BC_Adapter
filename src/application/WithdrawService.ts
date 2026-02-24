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
import { NotFoundError, ErrorCode } from "../shared/errors";
import { withErrorHandling } from "./support/withErrorHandling";
import { successResponse } from "../shared/response";

export class WithdrawService implements WithdrawUseCase {
  readonly withdraw: (req: WithdrawRequest) => Promise<void>;
  readonly checkStatus: (req: CheckWithdrawStatusRequest) => Promise<void>;

  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly bundler: BundlerPort,
    private readonly kms: KmsPort,
    private readonly publisher: MessagePublisher,
  ) {
    this.withdraw = withErrorHandling(
      publisher,
      {
        topic: "adapter.withdraw.sent",
        label: "Withdraw",
        getRequestId: (req) => req.requestId,
      },
      async (req) => {
        const { requestId, chain, fromAddress, toAddress, amount, token } = req;

        const account = await this.accountRepo.findByAddress(fromAddress);
        if (!account) {
          throw new NotFoundError(`Account not found: ${fromAddress}`, ErrorCode.ACCOUNT_NOT_FOUND);
        }

        const signingKey = await this.kms.getSigningKey();
        const ownerAddress = computeAddress(signingKey);

        const { userOp, userOpHash } = await this.bundler.buildUserOperation({
          chain,
          sender: fromAddress,
          toAddress,
          amount,
          token,
          ownerAddress,
          salt: account.salt,
        });

        const signature = await this.kms.sign(userOpHash);
        userOp.signature = signature;

        const sentHash = await this.bundler.sendUserOperation(chain, userOp);

        console.log(`[Withdraw] Sent UserOp: ${sentHash} for request ${requestId}`);

        await this.publisher.publish(
          "adapter.withdraw.sent",
          successResponse(requestId, {
            chain,
            fromAddress,
            toAddress,
            amount,
            token,
            userOpHash: sentHash,
          }),
        );
      },
    );

    this.checkStatus = withErrorHandling(
      publisher,
      {
        topic: "adapter.withdraw.confirmed",
        label: "Withdraw",
        getRequestId: (req) => req.requestId,
        getErrorContext: (req) => ({ userOpHash: req.userOpHash, status: "failed" as const }),
      },
      async (req) => {
        const { requestId, chain, userOpHash } = req;

        const receipt = await this.bundler.getUserOperationReceipt(chain, userOpHash);

        if (!receipt) {
          console.log(`[Withdraw] Receipt not found yet: ${userOpHash}`);
          await this.publisher.publish(
            "adapter.withdraw.confirmed",
            successResponse(requestId, { userOpHash, status: "pending" }),
          );
          return;
        }

        console.log(
          `[Withdraw] Status: ${userOpHash} -> ${receipt.success ? "success" : "failed"}, tx: ${receipt.txHash}`,
        );

        await this.publisher.publish(
          "adapter.withdraw.confirmed",
          successResponse(requestId, {
            userOpHash,
            success: receipt.success,
            txHash: receipt.txHash,
            actualGasCost: receipt.actualGasCost,
            actualGasUsed: receipt.actualGasUsed,
          }),
        );
      },
    );
  }
}
