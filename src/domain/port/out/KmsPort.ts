export interface KmsPort {
  getSigningKey(): Promise<string>;
  sign(data: string): Promise<string>;
}
