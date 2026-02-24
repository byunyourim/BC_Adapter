import { Chain } from './common';

export interface CreateAccountRequest {
  /**
   * @description 요청 추적 ID
   * @example "req-1"
   */
  requestId: string;

  /**
   * @description 블록체인 네트워크
   * @example "sepolia"
   */
  chain: Chain;

  /**
   * @description 지갑 주소 유도용 salt
   * @example "my-wallet-001"
   */
  salt: string;
}

/**
 * @title 성공
 */
export interface AccountCreatedSuccess {
  /** @example "req-1" */
  requestId?: string;

  /**
   * @description 생성된 지갑 주소
   * @example "0x1234abcd..."
   */
  address?: string;

  /** @example "sepolia" */
  chain?: string;

  /** @example "my-wallet-001" */
  salt?: string;
}

/**
 * @title 실패
 */
export interface AccountCreatedError {
  /** @example "req-1" */
  requestId?: string;

  /** @example "KMS signing key unavailable" */
  error?: string;

  /** @example "KMS_KEY_RETRIEVAL_FAILED" */
  errorCode?: string;
}
