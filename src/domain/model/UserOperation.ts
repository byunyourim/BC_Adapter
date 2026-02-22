export interface UserOperation {
  sender: string;
  nonce: string;
  callData: string;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  signature: string;
  // ERC-4337 v0.7 packed fields
  initCode: string;
  paymasterAndData: string;
}
