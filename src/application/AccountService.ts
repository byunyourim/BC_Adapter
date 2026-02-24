import {
  CreateAccountUseCase,
  CreateAccountRequest,
} from "../domain/port/in/CreateAccountUseCase";
import { AccountRepository } from "../domain/port/out/AccountRepository";
import { KmsPort } from "../domain/port/out/KmsPort";
import { BlockchainPort } from "../domain/port/out/BlockchainPort";
import { MessagePublisher } from "../domain/port/out/MessagePublisher";
import { withErrorHandling } from "./support/withErrorHandling";
import { successResponse } from "../shared/response";

export class AccountService implements CreateAccountUseCase {
  readonly createAccount: (req: CreateAccountRequest) => Promise<void>;

  constructor(
    private readonly accountRepo: AccountRepository,
    private readonly kms: KmsPort,
    private readonly blockchain: BlockchainPort,
    private readonly publisher: MessagePublisher,
  ) {
    this.createAccount = withErrorHandling(
      publisher,
      {
        topic: "adapter.account.created",
        label: "Account",
        getRequestId: (req) => req.requestId,
      },
      async (req) => {
        const { requestId, chain, salt } = req;

        const existing = await this.accountRepo.findBySalt(salt);
        if (existing) {
          console.log(`[Account] Duplicate salt: ${salt}, returning existing address`);
          await this.publisher.publish(
            "adapter.account.created",
            successResponse(requestId, {
              address: existing.address,
              chain: existing.chain,
              salt,
            }),
          );
          return;
        }

        await this.kms.getSigningKey();

        const address = this.blockchain.computeAddress(salt);

        await this.accountRepo.save({ address, chain, salt });

        console.log(`[Account] Created: ${address} on ${chain}`);

        await this.publisher.publish(
          "adapter.account.created",
          successResponse(requestId, { address, chain, salt }),
        );
      },
    );
  }
}
