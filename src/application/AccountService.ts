import {
  CreateAccountUseCase,
  CreateAccountRequest,
} from "../domain/port/in/CreateAccountUseCase";
import { AccountRepository } from "../domain/port/out/AccountRepository";
import { KmsPort } from "../domain/port/out/KmsPort";
import { BlockchainPort } from "../domain/port/out/BlockchainPort";
import { MessagePublisher } from "../domain/port/out/MessagePublisher";

export class AccountService implements CreateAccountUseCase {
  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly kms: KmsPort,
    private readonly blockchain: BlockchainPort,
    private readonly publisher: MessagePublisher,
  ) {}

  async createAccount(req: CreateAccountRequest): Promise<void> {
    const { requestId, chain, salt } = req;

    try {
      const existing = await this.accountRepo.findBySalt(salt);
      if (existing) {
        console.log(`[Account] Duplicate salt: ${salt}, returning existing address`);
        await this.publisher.publish("adapter.account.created", {
          requestId,
          address: existing.address,
          chain: existing.chain,
          salt,
        });
        return;
      }

      await this.kms.getSigningKey();

      const address = this.blockchain.computeAddress(salt);

      await this.accountRepo.save({ address, chain, salt });

      console.log(`[Account] Created: ${address} on ${chain}`);

      await this.publisher.publish("adapter.account.created", {
        requestId,
        address,
        chain,
        salt,
      });
    } catch (err) {
      console.error("[Account] Creation failed:", err);
      await this.publisher.publish("adapter.account.created", {
        requestId,
        error: (err as Error).message,
      });
    }
  }
}
