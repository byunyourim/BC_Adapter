import {
  HandleDepositUseCase,
  DepositEvent,
} from "../domain/port/in/HandleDepositUseCase";
import {
  CheckConfirmUseCase,
  CheckConfirmRequest,
} from "../domain/port/in/CheckConfirmUseCase";
import { AccountRepository } from "../domain/port/out/AccountRepository";
import { BlockchainPort } from "../domain/port/out/BlockchainPort";
import { MessagePublisher } from "../domain/port/out/MessagePublisher";
import { withErrorHandling } from "./support/withErrorHandling";
import { successResponse } from "../shared/response";

export class DepositService implements HandleDepositUseCase, CheckConfirmUseCase {
  readonly checkConfirm: (req: CheckConfirmRequest) => Promise<void>;

  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly blockchain: BlockchainPort,
    private readonly publisher: MessagePublisher,
  ) {
    this.checkConfirm = withErrorHandling(
      publisher,
      {
        topic: "adapter.deposit.confirmed",
        label: "Deposit",
        getRequestId: (req) => req.requestId,
        getErrorContext: (req) => ({ txHash: req.txHash, status: "failed" as const }),
      },
      async (req) => {
        const { requestId, txHash, chain } = req;

        const result = await this.blockchain.checkConfirmations(chain, txHash);

        console.log(
          `[Deposit] Confirm check: ${txHash} -> ${result.status} (${result.confirmations}/${result.required})`,
        );

        await this.publisher.publish(
          "adapter.deposit.confirmed",
          successResponse(requestId, { ...result }),
        );
      },
    );
  }

  async handleDeposit(event: DepositEvent): Promise<void> {
    const { txHash, toAddress, amount, chain } = event;

    try {
      const account = await this.accountRepo.findByAddress(toAddress.toLowerCase());

      if (!account) {
        console.log(`[Deposit] Unknown address: ${toAddress}`);
        return;
      }

      console.log(`[Deposit] Matched: ${toAddress} on ${chain}, tx: ${txHash}`);

      await this.publisher.publish("adapter.deposit.detected", {
        txHash,
        address: toAddress,
        amount,
        chain,
      });
    } catch (err) {
      console.error(`[Deposit] handleDeposit failed for tx ${txHash}:`, err);
    }
  }
}
