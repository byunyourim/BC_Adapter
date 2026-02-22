import { JsonRpcProvider, getCreate2Address, keccak256, AbiCoder } from "ethers";
import {
  BlockchainPort,
  ConfirmResult,
} from "../../../domain/port/out/BlockchainPort";

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
    const receipt = await provider.getTransactionReceipt(txHash);
    const required = this.blockchainConfig.requiredConfirmations;

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
  }

  private getProvider(chain: string): JsonRpcProvider {
    const existing = this.providers.get(chain);
    if (existing) return existing;

    const url = this.blockchainConfig.rpcUrls[chain];
    if (!url) throw new Error(`No RPC URL configured for chain: ${chain}`);

    const provider = new JsonRpcProvider(url);
    this.providers.set(chain, provider);
    return provider;
  }
}
