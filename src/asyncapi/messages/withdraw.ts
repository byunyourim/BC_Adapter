import { Chain } from './common';

export interface WithdrawRequest {
  /** @example "req-3" */
  requestId: string;

  /** @example "sepolia" */
  chain: Chain;

  /**
   * @description 출금 지갑 주소
   * @example "0x1234abcd..."
   */
  fromAddress: string;

  /**
   * @description 수신 주소
   * @example "0x5678efgh..."
   */
  toAddress: string;

  /**
   * @description 출금 금액 (wei)
   * @example "10000000000000"
   */
  amount: string;

  /**
   * @description "ETH 또는 ERC-20 컨트랙트 주소"
   * @example "ETH"
   */
  token: string;
}

/**
 * @title 성공
 */
export interface WithdrawSentSuccess {
  /** @example "req-3" */
  requestId?: string;

  /** @example "sepolia" */
  chain?: string;

  /** @example "0x1234abcd..." */
  fromAddress?: string;

  /** @example "0x5678efgh..." */
  toAddress?: string;

  /** @example "10000000000000" */
  amount?: string;

  /** @example "ETH" */
  token?: string;

  /**
   * @description UserOperation 해시
   * @example "0xdef456..."
   */
  userOpHash?: string;
}

/**
 * @title 실패
 */
export interface WithdrawSentError {
  /** @example "req-3" */
  requestId?: string;

  /** @example "Account not found: 0x1234abcd..." */
  error?: string;

  /** @example "ACCOUNT_NOT_FOUND" */
  errorCode?: string;
}

export interface CheckWithdrawStatusRequest {
  /** @example "req-4" */
  requestId: string;

  /** @example "sepolia" */
  chain: Chain;

  /**
   * @description 확인할 UserOperation 해시
   * @example "0xdef456..."
   */
  userOpHash: string;
}

/**
 * @title 처리 중
 */
export interface WithdrawPending {
  /** @example "req-4" */
  requestId?: string;

  /** @example "0xdef456..." */
  userOpHash?: string;

  /** @enum pending */
  status?: 'pending';
}

/**
 * @title 성공
 */
export interface WithdrawSuccess {
  /** @example "req-4" */
  requestId?: string;

  /** @example "0xdef456..." */
  userOpHash?: string;

  /** @example true */
  success?: boolean;

  /**
   * @description 온체인 트랜잭션 해시
   * @example "0x789ghi..."
   */
  txHash?: string;

  /** @example "21000" */
  actualGasCost?: string;

  /** @example "21000" */
  actualGasUsed?: string;
}

/**
 * @title 실패
 */
export interface WithdrawFailed {
  /** @example "req-4" */
  requestId?: string;

  /** @example "0xdef456..." */
  userOpHash?: string;

  /** @enum failed */
  status?: 'failed';

  /** @example "UserOp reverted" */
  error?: string;

  /** @example "BUNDLER_SEND_FAILED" */
  errorCode?: string;
}
