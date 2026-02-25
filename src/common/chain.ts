import { ValidationError, ErrorCode } from "./errors";

export type Chain = "ethereum" | "polygon" | "sepolia";

export const CHAIN_IDS: Record<Chain, number> = {
  ethereum: 1,
  polygon: 137,
  sepolia: 11155111,
};

export function validateChain(chain: string): asserts chain is Chain {
  if (!(chain in CHAIN_IDS)) {
    throw new ValidationError(ErrorCode.UNSUPPORTED_CHAIN, chain);
  }
}
