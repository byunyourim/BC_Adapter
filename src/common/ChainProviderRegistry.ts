import { JsonRpcProvider } from "ethers";
import { InfrastructureError } from "./errors";

export class ChainProviderRegistry {
  private readonly providers = new Map<string, JsonRpcProvider>();

  constructor(
    private readonly urls: Record<string, string>,
    private readonly errorCode: string,
    private readonly label: string,
  ) {}

  get(chain: string): JsonRpcProvider {
    const existing = this.providers.get(chain);
    if (existing) return existing;

    const url = this.urls[chain];
    if (!url) {
      throw new InfrastructureError(this.errorCode, chain);
    }

    const provider = new JsonRpcProvider(url);
    this.providers.set(chain, provider);
    return provider;
  }
}
