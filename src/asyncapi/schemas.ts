import { AsyncApi, Subscribe, Publish } from './decorators';
import { CreateAccountRequest, AccountCreatedSuccess, AccountCreatedError } from './messages/account';
import {
  DepositDetectedEvent,
  CheckConfirmRequest,
  DepositConfirmSuccess,
  DepositConfirmError,
} from './messages/deposit';
import {
  WithdrawRequest,
  WithdrawSentSuccess,
  WithdrawSentError,
  CheckWithdrawStatusRequest,
  WithdrawPending,
  WithdrawSuccess,
  WithdrawFailed,
} from './messages/withdraw';

@AsyncApi({
  title: 'BC Adapter',
  version: '1.0.0',
  description:
    '블록체인 어댑터 Kafka 메시징 API.\n계정 생성, 입금 감지/컨펌, 출금 요청/상태 확인 기능을 제공합니다.',
  server: { name: 'local', url: 'localhost:9092', protocol: 'kafka' },
})
export class BcAdapterChannels {
  // ── Account ──

  @Subscribe({
    channel: 'adapter.account.create',
    operationId: 'createAccount',
    summary: '새 지갑 계정을 생성합니다',
    description: '계정 생성 요청',
  })
  createAccount(_req: CreateAccountRequest): void {}

  @Publish({
    channel: 'adapter.account.created',
    operationId: 'onAccountCreated',
    summary: '계정 생성 결과를 수신합니다',
    description: '계정 생성 결과',
  })
  onAccountCreated(_result: AccountCreatedSuccess | AccountCreatedError): void {}

  // ── Deposit ──

  @Publish({
    channel: 'adapter.deposit.detected',
    operationId: 'onDepositDetected',
    summary: '등록된 주소로의 입금이 감지되었습니다',
    description: '입금 감지 알림 (WebSocket으로 수신한 입금을 등록된 주소와 매칭 후 발행)',
  })
  onDepositDetected(_event: DepositDetectedEvent): void {}

  @Subscribe({
    channel: 'adapter.deposit.confirm',
    operationId: 'checkDepositConfirm',
    summary: '트랜잭션의 컨펌 상태를 확인합니다',
    description: '입금 컨펌 확인 요청',
  })
  checkDepositConfirm(_req: CheckConfirmRequest): void {}

  @Publish({
    channel: 'adapter.deposit.confirmed',
    operationId: 'onDepositConfirmed',
    summary: '입금 컨펌 확인 결과를 수신합니다',
    description: '입금 컨펌 확인 결과',
  })
  onDepositConfirmed(_result: DepositConfirmSuccess | DepositConfirmError): void {}

  // ── Withdraw ──

  @Subscribe({
    channel: 'adapter.withdraw.request',
    operationId: 'withdraw',
    summary: 'ERC-4337 UserOperation을 통해 출금합니다',
    description: '출금 요청',
  })
  withdraw(_req: WithdrawRequest): void {}

  @Publish({
    channel: 'adapter.withdraw.sent',
    operationId: 'onWithdrawSent',
    summary: '출금 UserOperation 전송 결과를 수신합니다',
    description: '출금 전송 결과',
  })
  onWithdrawSent(_result: WithdrawSentSuccess | WithdrawSentError): void {}

  @Subscribe({
    channel: 'adapter.withdraw.status',
    operationId: 'checkWithdrawStatus',
    summary: 'UserOperation의 온체인 처리 상태를 확인합니다',
    description: '출금 상태 확인 요청',
  })
  checkWithdrawStatus(_req: CheckWithdrawStatusRequest): void {}

  @Publish({
    channel: 'adapter.withdraw.confirmed',
    operationId: 'onWithdrawConfirmed',
    summary: '출금 최종 처리 결과를 수신합니다',
    description: '출금 최종 결과',
  })
  onWithdrawConfirmed(_result: WithdrawPending | WithdrawSuccess | WithdrawFailed): void {}
}
