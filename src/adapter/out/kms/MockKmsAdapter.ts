import { Wallet, SigningKey } from "ethers";
import { KmsPort } from "../../../domain/port/out/KmsPort";

export class MockKmsAdapter implements KmsPort {
  private readonly privateKey: string;
  private readonly address: string;

  constructor(privateKey?: string) {
    const wallet = privateKey
      ? new Wallet(privateKey)
      : Wallet.createRandom();

    this.privateKey = wallet.privateKey;
    this.address = wallet.address;

    console.log(`[MockKMS] Owner address: ${this.address}`);
    console.log(`[MockKMS] Private key: ${this.privateKey}`);
  }

  async getSigningKey(): Promise<string> {
    return this.privateKey;
  }

  async sign(data: string): Promise<string> {
    const signingKey = new SigningKey(this.privateKey);
    const signature = signingKey.sign(data);
    return signature.serialized;
  }
}
