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

export class DepositService implements HandleDepositUseCase, CheckConfirmUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly blockchain: BlockchainPort,
    private readonly publisher: MessagePublisher,
  ) {}

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

  async checkConfirm(req: CheckConfirmRequest): Promise<void> {
    const { requestId, txHash, chain } = req;

    try {
      const result = await this.blockchain.checkConfirmations(chain, txHash);

      console.log(
        `[Deposit] Confirm check: ${txHash} -> ${result.status} (${result.confirmations}/${result.required})`,
      );

      await this.publisher.publish("adapter.deposit.confirmed", {
        requestId,
        ...result,
      });
    } catch (err) {
      console.error("[Deposit] Confirm check failed:", err);
      await this.publisher.publish("adapter.deposit.confirmed", {
        requestId,
        txHash,
        status: "failed",
        error: (err as Error).message,
      });
    }
  }
}
