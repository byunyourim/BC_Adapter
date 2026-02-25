import { keccak256, AbiCoder } from "ethers";

export function hashSalt(salt: string): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(["string"], [salt]),
  );
}
