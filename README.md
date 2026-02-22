# BC Adapter

Wallet backend ↔ EVM blockchain adapter via Kafka.

계정 생성(CREATE2), 입금 감지, 트랜잭션 컨펌 체크, ERC-4337 출금을 Kafka 메시징과 WebSocket을 통해 처리한다.

## Architecture

**헥사고날 아키텍처 (포트 & 어댑터)** 패턴을 적용하여 도메인 로직이 인프라에 의존하지 않도록 설계했다.

```
src/
├── domain/           # 순수 TypeScript — 외부 라이브러리 의존 없음
│   ├── model/        # Account, UserOperation 도메인 모델
│   └── port/
│       ├── in/       # 인바운드 유스케이스 (CreateAccount, HandleDeposit, CheckConfirm, Withdraw)
│       └── out/      # 아웃바운드 포트 (Repository, KMS, Blockchain, Bundler, MessagePublisher)
├── application/      # 유스케이스 구현 — domain/port 인터페이스만 의존
│   ├── AccountService.ts
│   ├── DepositService.ts
│   └── WithdrawService.ts
├── adapter/
│   ├── in/           # 외부 요청 수신
│   │   ├── kafka/    # Kafka consumer → 유스케이스 호출
│   │   └── websocket/# WebSocket 서버 → 입금 이벤트 수신
│   └── out/          # 인프라 구현체
│       ├── persistence/  # TypeORM (PostgreSQL)
│       ├── messaging/    # Kafka producer
│       ├── blockchain/   # ethers.js (RPC, CREATE2, confirm)
│       ├── bundler/      # ERC-4337 번들러 (JSON-RPC)
│       └── kms/          # NHN Cloud KMS / MockKMS
├── shared/           # 공통 유틸리티
│   └── validation.ts # requireFields 등 입력 검증
├── config/           # 환경변수, DataSource, Kafka 클라이언트
└── app.ts            # Composition Root — DI 조립 + 부트스트랩
```

### 의존성 방향

```
adapter/in → domain/port/in (유스케이스 인터페이스)
application → domain/port/out (아웃바운드 포트 인터페이스)
adapter/out → domain/port/out (포트 구현)
app.ts → 모든 모듈 (조립 전용)
```

`domain/`과 `application/`은 외부 라이브러리에 직접 의존하지 않는다.
(단, `application/WithdrawService`는 `ethers`의 `computeAddress`를 사용)

---

## Data Flow

### 1. 계정 생성

```
Kafka(adapter.account.create)
  → KafkaConsumerAdapter
    → requireFields 검증 (requestId, chain, salt)
    → AccountService.createAccount()
      → AccountRepository.findBySalt()       // 중복 체크
      → KmsPort.getSigningKey()
      → BlockchainPort.computeAddress(salt)
      → AccountRepository.save()
      → MessagePublisher.publish(adapter.account.created)
```

- 동일 salt로 재요청 시 기존 주소를 반환한다 (멱등성).

### 2. 입금 감지

```
WebSocket(deposit event)
  → WebSocketAdapter
    → DepositService.handleDeposit()
      → AccountRepository.findByAddress()
      → MessagePublisher.publish(adapter.deposit.detected)
```

- 미등록 주소는 무시한다.

### 3. 컨펌 체크

```
Kafka(adapter.deposit.confirm)
  → KafkaConsumerAdapter
    → requireFields 검증 (requestId, txHash, chain)
    → DepositService.checkConfirm()
      → BlockchainPort.checkConfirmations()
      → MessagePublisher.publish(adapter.deposit.confirmed)
```

### 4. 출금 (ERC-4337)

```
Kafka(adapter.withdraw.request)
  → KafkaConsumerAdapter
    → requireFields 검증 (requestId, chain, fromAddress, toAddress, amount, token)
    → WithdrawService.withdraw()
      → AccountRepository.findByAddress(fromAddress)
      → KmsPort.getSigningKey() → owner 주소 유도
      → BundlerPort.buildUserOperation()     // nonce 조회, 미배포 시 initCode 포함
      → KmsPort.sign(userOpHash)
      → BundlerPort.sendUserOperation()
      → MessagePublisher.publish(adapter.withdraw.sent)
```

```
Kafka(adapter.withdraw.status)
  → KafkaConsumerAdapter
    → requireFields 검증 (requestId, chain, userOpHash)
    → WithdrawService.checkStatus()
      → BundlerPort.getUserOperationReceipt()
      → MessagePublisher.publish(adapter.withdraw.confirmed)
```

- 첫 출금 시 AA 지갑이 온체인에 미배포 상태면 `initCode`를 자동 포함하여 배포 + 전송을 한 번에 처리한다.
- 모든 에러는 catch 후 `error` 필드를 포함한 응답을 Kafka로 발행한다.

---

## Quick Start

### 1. 인프라 실행

```bash
docker compose up -d
docker compose ps   # postgres, kafka 둘 다 healthy 확인
```

### 2. Kafka 토픽 생성

```bash
for topic in adapter.account.create adapter.account.created \
  adapter.deposit.confirm adapter.deposit.detected adapter.deposit.confirmed \
  adapter.withdraw.request adapter.withdraw.sent \
  adapter.withdraw.status adapter.withdraw.confirmed; do
  docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server localhost:9092 \
    --create --topic "$topic" \
    --partitions 1 --replication-factor 1 --if-not-exists
done
```

### 3. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일을 열어 필요한 항목을 채운다. 아래 두 가지 모드 중 선택:

#### 모드 A: Mock KMS (외부 의존 없이 로컬 테스트)

NHN Cloud KMS 없이 로컬에서 테스트할 수 있다.
MockKmsAdapter가 ethers.js로 랜덤 키를 생성하여 서명한다.

`.env`에서 KMS 관련 항목은 수정하지 않아도 된다. 실행 시 환경변수로 전환한다:

```bash
# 랜덤 키 (매 실행마다 새 owner)
USE_MOCK_KMS=true npm run dev

# 고정 키 (재시작해도 같은 owner 주소 유지)
USE_MOCK_KMS=true MOCK_KMS_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 npm run dev
```

기동 시 owner 주소와 private key가 로그에 출력된다:

```
[MockKMS] Owner address: 0xe4E5363985A054a16C4cfe6B97C9F43448c1F15a
[MockKMS] Private key: 0xbc05e673859c508acb1a436bdb7d4e2cbb34d3a0dc950614f73ebb1c21538be6
```

#### 모드 B: 실제 NHN Cloud KMS + Sepolia 테스트넷

외부 서비스 API 키를 발급받아 `.env`에 채운다:

| 항목 | 설명 | 발급처 |
|---|---|---|
| `SEPOLIA_RPC_URL` | Sepolia 노드 RPC | [Infura](https://app.infura.io) 또는 [Alchemy](https://dashboard.alchemy.com) |
| `SEPOLIA_BUNDLER_URL` | ERC-4337 번들러 | [Pimlico](https://dashboard.pimlico.io) (무료) |
| `NHN_KMS_APP_KEY` 등 | NHN Cloud KMS 인증 | NHN Cloud 콘솔 |

ERC-4337 공식 컨트랙트 주소는 Sepolia에 이미 배포되어 있으므로 수정 불필요:

```bash
ENTRY_POINT_ADDRESS=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
ACCOUNT_FACTORY_ADDRESS=0x9406Cc6185a346906296840746125a0E44976454
```

### 4. 앱 실행

```bash
npm install
npm run dev
```

정상 기동 시 출력:

```
[App] Database connected
[Kafka] Producer connected
[Kafka] Consumer subscribed to: adapter.account.create, adapter.deposit.confirm, adapter.withdraw.request, adapter.withdraw.status
[WS] Server listening on port 8080
[App] BC Adapter is running
```

---

## E2E 테스트

Kafka 메시지를 직접 보내서 전체 플로우를 테스트한다.
아래 예시는 `docker compose exec`의 kafka-console-producer를 사용한다.
(또는 `brew install kcat`으로 kcat을 설치하여 사용 가능)

### Step 1 — AA 지갑 생성

```bash
echo '{"requestId":"req-1","chain":"sepolia","salt":"my-test-wallet-001"}' \
  | docker compose exec -T kafka \
    /opt/kafka/bin/kafka-console-producer.sh \
    --bootstrap-server localhost:9092 \
    --topic adapter.account.create
```

앱 로그에서 결과 확인:

```
[Kafka] Received on adapter.account.create: { requestId: 'req-1', chain: 'sepolia', salt: 'my-test-wallet-001' }
[Account] Created: 0x77d66648F2D39FBF3813f1E389F9d52DE2e3D6b1 on sepolia
[Kafka] Sent to adapter.account.created: {
  requestId: 'req-1',
  address: '0x77d66648F2D39FBF3813f1E389F9d52DE2e3D6b1',
  chain: 'sepolia',
  salt: 'my-test-wallet-001'
}
```

또는 Kafka consumer로 응답 토픽을 직접 확인:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic adapter.account.created \
  --from-beginning
```

### Step 2 — Sepolia ETH 충전 (온체인 테스트 시)

Mock 모드에서 Kafka 플로우만 확인할 때는 이 단계를 건너뛸 수 있다.
실제 온체인 출금을 테스트하려면 Step 1에서 생성된 주소로 Sepolia ETH를 보낸다 (0.05 ETH 이상 권장).

지갑이 아직 배포 안 됐어도 ETH 수신은 가능하다.

- [Google Cloud Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
- [Alchemy Faucet](https://www.alchemy.com/faucets/ethereum-sepolia)
- MetaMask에서 직접 전송

### Step 3 — 출금 요청

`fromAddress`에 Step 1에서 받은 주소를 넣는다:

```bash
echo '{"requestId":"req-2","chain":"sepolia","fromAddress":"0x77d66648F2D39FBF3813f1E389F9d52DE2e3D6b1","toAddress":"0x000000000000000000000000000000000000dEaD","amount":"10000000000000","token":"ETH"}' \
  | docker compose exec -T kafka \
    /opt/kafka/bin/kafka-console-producer.sh \
    --bootstrap-server localhost:9092 \
    --topic adapter.withdraw.request
```

앱 로그에서 결과 확인:

```
[Kafka] Received on adapter.withdraw.request: {
  requestId: 'req-2',
  chain: 'sepolia',
  fromAddress: '0x77d66648F2D39FBF3813f1E389F9d52DE2e3D6b1',
  toAddress: '0x000000000000000000000000000000000000dEaD',
  amount: '10000000000000',
  token: 'ETH'
}
```

- RPC/번들러 연결 성공 시: `[Withdraw] Sent UserOp: 0x...`
- RPC 미설정 시: `[Kafka] Sent to adapter.withdraw.sent: { requestId: 'req-2', error: '...' }`

### Step 4 — 출금 상태 확인

Step 3에서 받은 `userOpHash`를 넣는다:

```bash
echo '{"requestId":"req-3","chain":"sepolia","userOpHash":"0x_STEP3에서_받은_해시"}' \
  | docker compose exec -T kafka \
    /opt/kafka/bin/kafka-console-producer.sh \
    --bootstrap-server localhost:9092 \
    --topic adapter.withdraw.status
```

응답 토픽 확인:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic adapter.withdraw.confirmed \
  --from-beginning
```

| 상태 | 응답 예시 |
|---|---|
| 처리 중 | `{"requestId":"req-3","userOpHash":"0x...","status":"pending"}` |
| 성공 | `{"requestId":"req-3","userOpHash":"0x...","success":true,"txHash":"0x..."}` |
| 실패 | `{"requestId":"req-3","userOpHash":"0x...","status":"failed","error":"..."}` |

성공 시 `txHash`를 https://sepolia.etherscan.io 에서 검색하여 온체인 트랜잭션을 확인할 수 있다.

---

## Kafka Topics

| Topic | Direction | Description |
|---|---|---|
| `adapter.account.create` | Inbound | 계정 생성 요청 |
| `adapter.account.created` | Outbound | 계정 생성 결과 |
| `adapter.deposit.confirm` | Inbound | 컨펌 체크 요청 |
| `adapter.deposit.detected` | Outbound | 입금 감지 알림 |
| `adapter.deposit.confirmed` | Outbound | 컨펌 체크 결과 |
| `adapter.withdraw.request` | Inbound | 출금 요청 |
| `adapter.withdraw.sent` | Outbound | UserOp 전송 결과 (userOpHash 포함) |
| `adapter.withdraw.status` | Inbound | 출금 상태 조회 요청 |
| `adapter.withdraw.confirmed` | Outbound | 최종 출금 결과 (txHash, success 포함) |

## Error Handling

| 계층 | 전략 |
|---|---|
| **KafkaConsumerAdapter** | `requireFields()`로 필수 필드 검증. JSON 파싱/핸들러 에러를 catch하여 로깅 후 다음 메시지 처리 계속 |
| **AccountService** | try-catch로 KMS/블록체인/DB 에러를 잡아 `error` 필드 포함 Kafka 응답 발행 |
| **DepositService.handleDeposit** | try-catch로 DB/Kafka 장애 시 에러 로깅 |
| **DepositService.checkConfirm** | try-catch로 RPC 에러 시 `status: "failed"` 응답 발행 |
| **WithdrawService.withdraw** | try-catch로 KMS/번들러/DB 에러를 잡아 `error` 필드 포함 Kafka 응답 발행 |
| **WithdrawService.checkStatus** | try-catch로 번들러 에러 시 `status: "failed"` 응답 발행 |
| **WebSocketAdapter** | 잘못된 JSON 메시지를 catch하여 로깅 |

## Adding a New Kafka Topic

레지스트리 패턴을 사용하므로 `app.ts`에서 한 줄로 등록한다:

```typescript
kafkaConsumer.register("adapter.new.topic", async (data) => {
  requireFields(data, ["requestId", "field1", "field2"]);
  await someUseCase.handle(data as SomeRequest);
});
```

`KafkaConsumerAdapter` 클래스를 수정할 필요 없음.

## Tech Stack

- **TypeScript** — 타입 안전성
- **ethers.js v6** — EVM 블록체인 상호작용 (CREATE2, ERC-4337 UserOp, 트랜잭션 컨펌)
- **KafkaJS** — Kafka 메시징
- **TypeORM** — PostgreSQL ORM
- **ws** — WebSocket 서버
- **axios** — NHN Cloud KMS REST API
- **Docker Compose** — PostgreSQL + Kafka (KRaft 모드) 로컬 인프라
