# 공통 응답 객체 및 에러 처리

## 공통 응답 구조

모든 Kafka 응답 메시지는 두 가지 형태 중 하나로 발행된다.

### 성공 응답

`successResponse(requestId, data)` — `src/shared/response.ts`

```json
{
  "requestId": "req-1",
  "address": "0x1234abcd...",
  "chain": "sepolia",
  "salt": "my-wallet-001"
}
```

`requestId`와 비즈니스 데이터가 flat하게 병합된다.

### 실패 응답

`errorResponse(requestId, err, extra?)` — `src/shared/response.ts`

```json
{
  "requestId": "req-1",
  "error": "Failed to retrieve signing key from KMS",
  "errorCode": "KMS_KEY_RETRIEVAL_FAILED"
}
```

| 필드 | 설명 |
|------|------|
| `requestId` | 요청 추적 ID |
| `error` | 사람이 읽을 수 있는 에러 메시지 |
| `errorCode` | 기계가 식별할 수 있는 에러 코드 |
| `...extra` | 선택적 추가 컨텍스트 (예: `txHash`, `status`) |

`AppError` 인스턴스이면 `err.code`를, 일반 `Error`이면 `"UNKNOWN_ERROR"`를 `errorCode`로 사용한다.

---

## 에러 처리 흐름

```
Kafka 메시지 수신
  └─ KafkaConsumerAdapter (in-adapter)
       └─ requireFields() 검증 ← ValidationError
            └─ Service 메서드 (withErrorHandling 래핑)
                 ├─ 비즈니스 로직 실행
                 │    ├─ out-adapter 호출 → InfrastructureError
                 │    └─ 도메인 검증 → NotFoundError / BusinessError
                 │
                 ├─ 성공 → publisher.publish(topic, successResponse(...))
                 └─ 실패 → publisher.publish(topic, errorResponse(...))
```

### 1단계: Kafka 메시지 수신 (`KafkaConsumerAdapter`)

```typescript
// src/adapter/in/kafka/KafkaConsumerAdapter.ts
await handler(data);  // handler = requireFields + service 메서드
```

- JSON 파싱 후 등록된 핸들러 호출
- 핸들러 내부에서 발생한 에러는 catch하여 로깅
- `AppError`이면 `err.name`, `err.code` 포함 로그 출력

### 2단계: 필수 필드 검증 (`requireFields`)

```typescript
// src/shared/validation.ts
throw new ValidationError(
  `Missing required fields: ${missing.join(", ")}`,
  ErrorCode.MISSING_REQUIRED_FIELDS
);
```

서비스 호출 전에 필수 필드 누락을 검증한다.

### 3단계: 에러 자동 포착 (`withErrorHandling`)

```typescript
// src/application/support/withErrorHandling.ts
return async (req) => {
  try {
    await fn(req);              // 서비스 로직 실행
  } catch (err) {
    const extra = getErrorContext?.(req);
    await publisher.publish(    // 실패 응답 발행
      topic,
      errorResponse(requestId, err, extra)
    );
  }
};
```

- 서비스 메서드를 래핑하는 HOF(고차 함수)
- 내부에서 throw된 모든 에러를 catch
- `errorResponse()`로 변환하여 Kafka로 발행
- 서비스 코드에는 try-catch가 불필요

### 4단계: out-adapter에서 세분화된 에러 throw

각 out-adapter는 실패 시 구체적인 `ErrorCode`와 함께 에러를 throw한다.

```typescript
// 예: NhnKmsAdapter
throw new InfrastructureError(
  "Failed to retrieve signing key from KMS",
  ErrorCode.KMS_KEY_RETRIEVAL_FAILED
);
```

---

## 에러 클래스 계층

```
Error
  └─ AppError (code: string)
       ├─ ValidationError      기본값: VALIDATION_ERROR
       ├─ NotFoundError         기본값: NOT_FOUND
       ├─ BusinessError         기본값: BUSINESS_ERROR
       └─ InfrastructureError   기본값: INFRA_ERROR
```

모든 에러 클래스는 `code` 파라미터를 선택적으로 받아 세분화된 에러 코드를 지정할 수 있다.
`code`를 생략하면 각 클래스의 기본값이 사용되어 하위 호환성이 유지된다.

---

## 에러 코드 목록

### Validation

| 코드 | 의미 | 발생 위치 |
|------|------|-----------|
| `VALIDATION_ERROR` | 일반 검증 오류 | ValidationError 기본값 |
| `MISSING_REQUIRED_FIELDS` | 필수 필드 누락 | `requireFields()` |
| `UNSUPPORTED_CHAIN` | 미지원 체인 | `ERC4337BundlerAdapter.getChainId()` |

### Not Found

| 코드 | 의미 | 발생 위치 |
|------|------|-----------|
| `NOT_FOUND` | 일반 조회 실패 | NotFoundError 기본값 |
| `ACCOUNT_NOT_FOUND` | 계정 조회 실패 | `WithdrawService.withdraw()` |

### Infrastructure — KMS

| 코드 | 의미 | 발생 위치 |
|------|------|-----------|
| `KMS_KEY_RETRIEVAL_FAILED` | 서명키 조회 실패 | `NhnKmsAdapter.getSigningKey()` |
| `KMS_SIGNING_FAILED` | 데이터 서명 실패 | `NhnKmsAdapter.sign()` |

### Infrastructure — Blockchain RPC

| 코드 | 의미 | 발생 위치 |
|------|------|-----------|
| `RPC_NOT_CONFIGURED` | RPC URL 미설정 | `EthersBlockchainAdapter.getProvider()`, `ERC4337BundlerAdapter.getNodeProvider()` |
| `RPC_CONNECTION_FAILED` | RPC 호출 실패 | `EthersBlockchainAdapter.checkConfirmations()` |

### Infrastructure — Bundler

| 코드 | 의미 | 발생 위치 |
|------|------|-----------|
| `BUNDLER_NOT_CONFIGURED` | Bundler URL 미설정 | `ERC4337BundlerAdapter.getBundlerProvider()` |
| `BUNDLER_BUILD_FAILED` | UserOp 빌드 실패 | `ERC4337BundlerAdapter.buildUserOperation()` |
| `BUNDLER_SEND_FAILED` | UserOp 전송 실패 | `ERC4337BundlerAdapter.sendUserOperation()` |
| `BUNDLER_RECEIPT_FAILED` | UserOp 영수증 조회 실패 | `ERC4337BundlerAdapter.getUserOperationReceipt()` |

### Infrastructure — DB

| 코드 | 의미 | 발생 위치 |
|------|------|-----------|
| `DB_SAVE_FAILED` | DB 저장 실패 | `TypeOrmAccountRepository.save()` |
| `DB_QUERY_FAILED` | DB 조회 실패 | `TypeOrmAccountRepository.findByAddress()`, `findBySalt()` |

### 기타

| 코드 | 의미 | 발생 위치 |
|------|------|-----------|
| `BUSINESS_ERROR` | 비즈니스 규칙 위반 | BusinessError 기본값 |
| `UNKNOWN_ERROR` | 분류 불가 에러 | `AppError`가 아닌 일반 `Error` |

---

## 유스케이스별 에러 응답 예시

### 계정 생성 실패

```json
{
  "requestId": "req-1",
  "error": "Failed to retrieve signing key from KMS",
  "errorCode": "KMS_KEY_RETRIEVAL_FAILED"
}
```

### 입금 컨펌 확인 실패

```json
{
  "requestId": "req-2",
  "error": "RPC call failed for chain sepolia: connection timeout",
  "errorCode": "RPC_CONNECTION_FAILED",
  "txHash": "0xabc123...",
  "status": "failed"
}
```

### 출금 실패 — 계정 미존재

```json
{
  "requestId": "req-3",
  "error": "Account not found: 0x1234abcd...",
  "errorCode": "ACCOUNT_NOT_FOUND"
}
```

### 출금 실패 — UserOp 전송 실패

```json
{
  "requestId": "req-3",
  "error": "Failed to send UserOperation: bundler rejected",
  "errorCode": "BUNDLER_SEND_FAILED"
}
```

### 필수 필드 누락

```json
{
  "requestId": "req-5",
  "error": "Missing required fields: chain, salt",
  "errorCode": "MISSING_REQUIRED_FIELDS"
}
```
