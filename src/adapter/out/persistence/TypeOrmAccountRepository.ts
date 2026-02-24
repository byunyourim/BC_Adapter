import { DataSource, Repository } from "typeorm";
import { AccountRepository } from "../../../domain/port/out/AccountRepository";
import { Account } from "../../../domain/model/Account";
import { AccountEntity } from "./AccountEntity";
import { InfrastructureError, ErrorCode } from "../../../shared/errors";

export class TypeOrmAccountRepository implements AccountRepository {
  private readonly repo: Repository<AccountEntity>;

  constructor(dataSource: DataSource) {
    this.repo = dataSource.getRepository(AccountEntity);
  }

  async save(account: Account): Promise<Account> {
    try {
      const entity = this.repo.create({
        address: account.address,
        chain: account.chain,
        salt: account.salt,
      });
      const saved = await this.repo.save(entity);
      return {
        id: saved.id,
        address: saved.address,
        chain: saved.chain,
        salt: saved.salt,
        createdAt: saved.createdAt,
      };
    } catch (error) {
      throw new InfrastructureError(
        `Failed to save account: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.DB_SAVE_FAILED,
      );
    }
  }

  async findByAddress(address: string): Promise<Account | null> {
    try {
      const entity = await this.repo.findOneBy({ address });
      if (!entity) return null;
      return {
        id: entity.id,
        address: entity.address,
        chain: entity.chain,
        salt: entity.salt,
        createdAt: entity.createdAt,
      };
    } catch (error) {
      throw new InfrastructureError(
        `Failed to query account by address: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.DB_QUERY_FAILED,
      );
    }
  }

  async findBySalt(salt: string): Promise<Account | null> {
    try {
      const entity = await this.repo.findOneBy({ salt });
      if (!entity) return null;
      return {
        id: entity.id,
        address: entity.address,
        chain: entity.chain,
        salt: entity.salt,
        createdAt: entity.createdAt,
      };
    } catch (error) {
      throw new InfrastructureError(
        `Failed to query account by salt: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.DB_QUERY_FAILED,
      );
    }
  }
}
