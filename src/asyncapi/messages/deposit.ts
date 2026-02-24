import { Chain } from './common';

export interface DepositDetectedEvent {
  /**
   * @description 트랜잭션 해시
   * @example "0xabc123..."
   */
  txHash?: string;

  /**
   * @description 입금 주소
   * @example "0x1234abcd..."
   */
  address?: string;

  /**
   * @description 입금 금액 (wei)
   * @example "1000000000000000000"
   */
  amount?: string;

  /** @example "sepolia" */
  chain?: string;
}

export interface CheckConfirmRequest {
  /** @example "req-2" */
  requestId: string;

  /**
   * @description 확인할 트랜잭션 해시
   * @example "0xabc123..."
   */
  txHash: string;

  /** @example "sepolia" */
  chain: Chain;
}

/**
 * @title 성공
 */
export interface DepositConfirmSuccess {
  /** @example "req-2" */
  requestId?: string;

  /** @example "0xabc123..." */
  txHash?: string;

  /** @enum confirmed,pending */
  status?: 'confirmed' | 'pending';

  /**
   * @description 현재 컨펌 수
   * @example 12
   */
  confirmations?: number;

  /**
   * @description 필요 컨펌 수
   * @example 12
   */
  required?: number;
}

/**
 * @title 실패
 */
export interface DepositConfirmError {
  /** @example "req-2" */
  requestId?: string;

  /** @example "0xabc123..." */
  txHash?: string;

  /** @enum failed */
  status?: 'failed';

  /** @example "RPC connection failed" */
  error?: string;

  /** @example "RPC_CONNECTION_FAILED" */
  errorCode?: string;
}
