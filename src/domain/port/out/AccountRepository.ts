import { Account } from "../../model/Account";

export interface AccountRepository {
  save(account: Account): Promise<Account>;
  findByAddress(address: string): Promise<Account | null>;
  findBySalt(salt: string): Promise<Account | null>;
}
