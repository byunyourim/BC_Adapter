import { JsonRpcProvider, getCreate2Address, keccak256, AbiCoder } from "ethers";
import {
  BlockchainPort,
  ConfirmResult,
} from "../../../domain/port/out/BlockchainPort";
import { InfrastructureError, ErrorCode } from "../../../shared/errors";

interface BlockchainConfig {
  rpcUrls: Record<string, string>;
  factoryAddress: string;
  initCodeHash: string;
  requiredConfirmations: number;
}

export class EthersBlockchainAdapter implements BlockchainPort {
  private readonly providers = new Map<string, JsonRpcProvider>();

  constructor(private readonly blockchainConfig: BlockchainConfig) {}

  computeAddress(salt: string): string {
    const saltHash = keccak256(
      AbiCoder.defaultAbiCoder().encode(["string"], [salt]),
    );
    return getCreate2Address(
      this.blockchainConfig.factoryAddress,
      saltHash,
      this.blockchainConfig.initCodeHash,
    );
  }

  async checkConfirmations(chain: string, txHash: string): Promise<ConfirmResult> {
    const provider = this.getProvider(chain);
    const required = this.blockchainConfig.requiredConfirmations;

    try {
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        return { txHash, status: "pending", confirmations: 0, required };
      }

      if (receipt.status === 0) {
        return { txHash, status: "failed", confirmations: 0, required };
      }

      const currentBlock = await provider.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber + 1;

      return {
        txHash,
        status: confirmations >= required ? "confirmed" : "pending",
        confirmations,
        required,
      };
    } catch (error) {
      if (error instanceof InfrastructureError) throw error;
      throw new InfrastructureError(
        `RPC call failed for chain ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.RPC_CONNECTION_FAILED,
      );
    }
  }

  private getProvider(chain: string): JsonRpcProvider {
    const existing = this.providers.get(chain);
    if (existing) return existing;

    const url = this.blockchainConfig.rpcUrls[chain];
    if (!url) throw new InfrastructureError(`No RPC URL configured for chain: ${chain}`, ErrorCode.RPC_NOT_CONFIGURED);

    const provider = new JsonRpcProvider(url);
    this.providers.set(chain, provider);
    return provider;
  }
}
