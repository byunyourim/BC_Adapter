# BC Adapter

Wallet backend ↔ EVM blockchain adapter via Kafka.

계정 생성(CREATE2), 입금 감지, 트랜잭션 컨펌 체크, ERC-4337 출금/결제를 Kafka 메시징과 WebSocket을 통해 처리한다.
출금/결제 시 동시 요청에 의한 nonce 충돌을 방지하기 위해 Redis에서 nonce를 원자적으로 관리한다.

---

## 개요

BC Adapter는 **Wallet Backend**가 블록체인을 직접 다루지 않아도 되도록, 중간에서 EVM 체인과의 모든 상호작용을 대행하는 어댑터 서비스이다.

### 왜 필요한가

Wallet Backend는 사용자 지갑, 잔액, 거래 내역 등 비즈니스 로직에 집중해야 한다. 블록체인 RPC 호출, 트랜잭션 서명, nonce 관리, 컨펌 대기 같은 인프라 관심사를 직접 다루면 복잡도가 급격히 올라간다. BC Adapter가 이 부분을 전담하여 Wallet Backend는 Kafka 메시지만 주고받으면 된다.

### 무엇을 하는가

| 기능 | 설명 |
|------|------|
| **계정 생성** | CREATE2로 스마트 컨트랙트 지갑 주소를 사전 계산하여 DB에 저장. 실제 배포는 첫 출금 시 자동 수행 |
| **입금 감지** | Deposit Listener(별도 서비스)가 WebSocket으로 전달한 입금 이벤트를 수신, 등록된 주소인지 확인 후 Kafka로 알림 |
| **입금 컨펌 확인** | Wallet Backend 요청 시 블록체인 RPC로 트랜잭션 컨펌 수를 조회하여 확정 여부 응답 |
| **출금/결제** | ERC-4337 기반 UserOperation을 빌드 → 서명 → EntryPoint.handleOps로 직접 온체인 제출. ETH 전송과 ERC-20 토큰 전송 모두 지원 |
| **출금 상태 확인** | 트랜잭션 영수증을 조회하여 성공/실패/처리중 상태 응답 |

### 핵심 설계 결정

- **Kafka 기반 비동기 통신**: Wallet Backend와의 모든 요청/응답은 Kafka 메시지로 처리. 서비스 간 결합도를 낮추고 장애 격리
- **헥사고날 아키텍처**: 도메인 로직이 인프라(Kafka, DB, RPC)에 의존하지 않도록 Port & Adapter 패턴 적용
- **Redis nonce 관리**: 동시 출금 요청 시 온체인 nonce 충돌을 방지하기 위해 Redis INCR로 원자적 관리. 실패 시 DECR로 롤백
- **내장 Bundler**: 별도 Bundler 서비스 없이 어댑터 프로세스 내에서 직접 EntryPoint 컨트랙트 호출
- **NHN Cloud KMS**: 서명 키를 어댑터가 보관하지 않고 외부 KMS에서 관리. 개발 환경용 MockKMS 제공

### 연동 시스템

```
Wallet Backend ──Kafka──▶ BC Adapter ──RPC──▶ EVM Blockchain
                              │
                              ├── PostgreSQL (계정 정보)
                              ├── Redis (nonce 관리)
                              ├── NHN Cloud KMS (서명)
                              └──◀── Deposit Listener (WebSocket)
```

### 지원 체인

| 체인 | 설명 |
|------|------|
| Ethereum | 메인넷 |
| Polygon | 메인넷 |
| Sepolia | 이더리움 테스트넷 (개발/테스트용) |

---

## Architecture

**헥사고날 아키텍처 (포트 & 어댑터)** 패턴을 적용하여 도메인 로직이 인프라에 의존하지 않도록 설계했다.

```
src/
├── domain/           # 순수 TypeScript — 외부 라이브러리 의존 없음
│   ├── model/        # Account, UserOperation 도메인 모델
│   └── port/
│       ├── in/       # 인바운드 유스케이스 (CreateAccount, HandleDeposit, CheckConfirm, Withdraw)
│       └── out/      # 아웃바운드 포트 (Repository, KMS, Blockchain, Bundler, Nonce, MessagePublisher)
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
│       ├── bundler/      # ERC-4337 번들러 (내장, EntryPoint 직접 호출)
│       ├── nonce/        # Redis 기반 nonce 관리
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
      → NoncePort.acquireNonce(chain, sender)  // Redis에서 원자적 nonce 획득
      → BundlerPort.buildUserOperation(nonce)  // 미배포 시 initCode 포함
      → KmsPort.sign(userOpHash)
      → BundlerPort.sendUserOperation()        // EntryPoint.handleOps 직접 호출
      → (실패 시) NoncePort.releaseNonce()     // nonce 롤백
      → MessagePublisher.publish(adapter.withdraw.sent)
```

```
Kafka(adapter.withdraw.status)
  → KafkaConsumerAdapter
    → requireFields 검증 (requestId, chain, userOpHash)
    → WithdrawService.checkStatus()
      → BundlerPort.getUserOperationReceipt()  // 트랜잭션 영수증 조회
      → MessagePublisher.publish(adapter.withdraw.confirmed)
```

- 첫 출금 시 AA 지갑이 온체인에 미배포 상태면 `initCode`를 자동 포함하여 배포 + 전송을 한 번에 처리한다.
- 모든 에러는 catch 후 `error` 필드를 포함한 응답을 Kafka로 발행한다.

---

## Quick Start

### 1. 인프라 실행

```bash
docker compose up -d
docker compose ps   # postgres, kafka, redis 모두 healthy 확인
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
[Redis] Connected to localhost:6379
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
| **WithdrawService.withdraw** | try-catch로 KMS/RPC/Redis/DB 에러를 잡아 `error` 필드 포함 Kafka 응답 발행. nonce 실패 시 롤백 |
| **WithdrawService.checkStatus** | try-catch로 RPC 에러 시 `status: "failed"` 응답 발행 |
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
- **ethers.js v6** — EVM 블록체인 상호작용 (CREATE2, ERC-4337 UserOp, EntryPoint 직접 호출)
- **KafkaJS** — Kafka 메시징
- **TypeORM** — PostgreSQL ORM
- **ioredis** — Redis 클라이언트 (nonce 원자적 관리)
- **ws** — WebSocket 서버
- **axios** — NHN Cloud KMS REST API
- **Docker Compose** — PostgreSQL + Kafka (KRaft 모드) + Redis 로컬 인프라
