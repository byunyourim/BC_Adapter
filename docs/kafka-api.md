# BC Adapter Kafka API

## 개요

BC Adapter는 Kafka 메시지 기반으로 동작합니다.
호출자가 요청 토픽에 메시지를 보내면, 처리 후 응답 토픽에 결과를 발행합니다.

모든 요청에는 `requestId`가 필수이며, 응답에 그대로 포함되어 요청-응답 매칭에 사용됩니다.

### 지원 체인

`ethereum` | `polygon` | `sepolia`

---

## 1. 계정 생성

**요청 토픽:** `adapter.account.create`

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| requestId | string | O | 요청 추적 ID |
| chain | string | O | 체인 이름 |
| salt | string | O | 지갑 주소 유도용 salt |

```json
{
  "requestId": "req-1",
  "chain": "sepolia",
  "salt": "my-wallet-001"
}
```

**응답 토픽:** `adapter.account.created`

성공:

| 필드 | 타입 | 설명 |
|---|---|---|
| requestId | string | 요청 추적 ID |
| address | string | 생성된 지갑 주소 |
| chain | string | 체인 이름 |

```json
{
  "requestId": "req-1",
  "address": "0x1234...abcd",
  "chain": "sepolia"
}
```

실패:

```json
{
  "requestId": "req-1",
  "error": "에러 메시지"
}
```

> 동일한 userId로 재요청 시 기존 주소를 반환합니다 (중복 생성 방지).

---

## 2. 입금 감지 (WebSocket)

입금 감지는 Kafka가 아닌 **WebSocket**으로 수신합니다.

**WebSocket 수신 메시지:**

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| txHash | string | O | 트랜잭션 해시 |
| toAddress | string | O | 입금 대상 주소 |
| amount | string | O | 입금 금액 (wei) |
| chain | string | O | 체인 이름 |

등록된 주소로의 입금이 감지되면 아래 토픽으로 발행합니다.

**발행 토픽:** `adapter.deposit.detected`

| 필드 | 타입 | 설명 |
|---|---|---|
| txHash | string | 트랜잭션 해시 |
| address | string | 입금 주소 |
| amount | string | 입금 금액 (wei) |
| chain | string | 체인 이름 |

---

## 3. 입금 컨펌 확인

**요청 토픽:** `adapter.deposit.confirm`

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| requestId | string | O | 요청 추적 ID |
| txHash | string | O | 확인할 트랜잭션 해시 |
| chain | string | O | 체인 이름 |

```json
{
  "requestId": "req-2",
  "txHash": "0xabc...123",
  "chain": "sepolia"
}
```

**응답 토픽:** `adapter.deposit.confirmed`

성공:

| 필드 | 타입 | 설명 |
|---|---|---|
| requestId | string | 요청 추적 ID |
| txHash | string | 트랜잭션 해시 |
| status | string | `confirmed` / `pending` |
| confirmations | number | 현재 컨펌 수 |
| required | number | 필요 컨펌 수 |

실패:

```json
{
  "requestId": "req-2",
  "txHash": "0xabc...123",
  "status": "failed",
  "error": "에러 메시지"
}
```

---

## 4. 출금 요청

**요청 토픽:** `adapter.withdraw.request`

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| requestId | string | O | 요청 추적 ID |
| chain | string | O | 체인 이름 |
| fromAddress | string | O | 출금 지갑 주소 |
| toAddress | string | O | 수신 주소 |
| amount | string | O | 출금 금액 (wei) |
| token | string | O | `ETH` 또는 ERC-20 컨트랙트 주소 |

```json
{
  "requestId": "req-3",
  "chain": "sepolia",
  "fromAddress": "0x1234...abcd",
  "toAddress": "0x5678...efgh",
  "amount": "10000000000000",
  "token": "ETH"
}
```

**응답 토픽:** `adapter.withdraw.sent`

성공:

| 필드 | 타입 | 설명 |
|---|---|---|
| requestId | string | 요청 추적 ID |
| chain | string | 체인 이름 |
| fromAddress | string | 출금 지갑 주소 |
| toAddress | string | 수신 주소 |
| amount | string | 출금 금액 |
| token | string | 토큰 |
| userOpHash | string | UserOperation 해시 |

실패:

```json
{
  "requestId": "req-3",
  "error": "에러 메시지"
}
```

---

## 5. 출금 상태 확인

**요청 토픽:** `adapter.withdraw.status`

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| requestId | string | O | 요청 추적 ID |
| chain | string | O | 체인 이름 |
| userOpHash | string | O | 확인할 UserOperation 해시 |

```json
{
  "requestId": "req-4",
  "chain": "sepolia",
  "userOpHash": "0xdef...456"
}
```

**응답 토픽:** `adapter.withdraw.confirmed`

처리 중:

```json
{
  "requestId": "req-4",
  "userOpHash": "0xdef...456",
  "status": "pending"
}
```

성공:

| 필드 | 타입 | 설명 |
|---|---|---|
| requestId | string | 요청 추적 ID |
| userOpHash | string | UserOperation 해시 |
| success | boolean | 성공 여부 |
| txHash | string | 온체인 트랜잭션 해시 |
| actualGasCost | string | 실제 가스 비용 |
| actualGasUsed | string | 실제 가스 사용량 |

실패:

```json
{
  "requestId": "req-4",
  "userOpHash": "0xdef...456",
  "status": "failed",
  "error": "에러 메시지"
}
```

---

## 토픽 요약

| 방향 | 토픽 | 설명 |
|---|---|---|
| 요청 | `adapter.account.create` | 계정 생성 |
| 응답 | `adapter.account.created` | 계정 생성 결과 |
| 발행 | `adapter.deposit.detected` | 입금 감지 알림 |
| 요청 | `adapter.deposit.confirm` | 입금 컨펌 확인 |
| 응답 | `adapter.deposit.confirmed` | 입금 컨펌 결과 |
| 요청 | `adapter.withdraw.request` | 출금 요청 |
| 응답 | `adapter.withdraw.sent` | 출금 전송 결과 |
| 요청 | `adapter.withdraw.status` | 출금 상태 확인 |
| 응답 | `adapter.withdraw.confirmed` | 출금 최종 결과 |
