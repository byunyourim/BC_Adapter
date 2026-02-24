import axios, { AxiosInstance } from "axios";
import { KmsPort } from "../../../domain/port/out/KmsPort";
import { InfrastructureError, ErrorCode } from "../../../shared/errors";

interface KmsConfig {
  appKey: string;
  secretKey: string;
  keyId: string;
  endpoint: string;
}

export class NhnKmsAdapter implements KmsPort {
  private readonly client: AxiosInstance;

  constructor(private readonly kmsConfig: KmsConfig) {
    this.client = axios.create({
      baseURL: kmsConfig.endpoint,
      headers: {
        "X-TC-APP-KEY": kmsConfig.appKey,
        "X-TC-AUTHENTICATION-ID": kmsConfig.secretKey,
        "Content-Type": "application/json",
      },
    });
  }

  async getSigningKey(): Promise<string> {
    const res = await this.client.get(
      `/keymanager/v1.2/appkey/${this.kmsConfig.appKey}/secrets/${this.kmsConfig.keyId}`,
    );

    if (!res.data?.body?.secret) {
      throw new InfrastructureError("Failed to retrieve signing key from KMS", ErrorCode.KMS_KEY_RETRIEVAL_FAILED);
    }

    return res.data.body.secret;
  }

  async sign(data: string): Promise<string> {
    const res = await this.client.post(
      `/keymanager/v1.2/appkey/${this.kmsConfig.appKey}/keys/${this.kmsConfig.keyId}/sign`,
      { data },
    );

    if (!res.data?.body?.signature) {
      throw new InfrastructureError("Failed to sign data via KMS", ErrorCode.KMS_SIGNING_FAILED);
    }

    return res.data.body.signature;
  }
}
