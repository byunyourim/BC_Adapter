# BC_Adapter Architecture Diagrams

> Wallet Backend ↔ EVM Blockchain Adapter — Hexagonal Architecture (Ports & Adapters)
> Persistence: Prisma + PostgreSQL

---

## 1. 전체 시스템 컨텍스트

```mermaid
graph TB
    WB[Wallet Backend]

    subgraph Listener[Deposit Listener - 별도 서비스]
        DL_ETH[Ethereum Listener]
        DL_POLY[Polygon Listener]
        DL_SEP[Sepolia Listener]
    end

    subgraph BC_Adapter
        KCA[KafkaConsumerAdapter]
        WSA[WebSocketAdapter]
        AS[AccountService]
        DS[DepositService]
        AC[Adapter_AC - 컨펌 체크]
        WS[WithdrawService]
        KPA[KafkaProducerAdapter]
        REPO[PrismaAccountRepository]
        BC[EthersBlockchainAdapter]
        BU[ERC4337BundlerAdapter]
        KMS[KmsAdapter]
    end

    PG[(PostgreSQL)]
    KAFKA[(Kafka Broker)]
    RPC[EVM RPC Node]
    BUNDLER[ERC-4337 Bundler Service]
    NHNKMS[NHN Cloud KMS]
    CHAIN[(Blockchain)]

    WB -->|Produce| KAFKA
    KAFKA -->|Consume| KCA

    CHAIN -->|블록 이벤트| Listener
    Listener -->|WebSocket Polling| WSA
    WSA --> DS

    KCA --> AS
    KCA -->|컨펌 요청| AC
    KCA --> WS

    AC -->|조회| BC
    BC --> RPC

    AS --> KPA
    DS --> KPA
    AC --> KPA
    WS --> KPA
    KPA -->|Publish| KAFKA
    KAFKA -->|Consume| WB

    AS --> REPO
    DS --> REPO
    WS --> REPO
    REPO --> PG

    AS --> BC

    WS --> BU
    BU -->|estimateGas, sendUserOp, getReceipt| BUNDLER
    BU -->|getCode, getNonce, getFeeData| RPC
    BUNDLER -->|bundled tx submit| CHAIN

    AS --> KMS
    WS --> KMS
    KMS --> NHNKMS
```

---

## 2. Hexagonal Architecture (레이어 구조)

```mermaid
graph LR
    subgraph InboundAdapters[Adapter In]
        KCA[KafkaConsumerAdapter]
        WSA[WebSocketAdapter]
    end

    subgraph InboundPorts[Port In]
        CAUC[CreateAccountUseCase]
        HDUC[HandleDepositUseCase]
        CCUC[CheckConfirmUseCase]
        WUC[WithdrawUseCase]
    end

    subgraph Application[Application Layer]
        AS[AccountService]
        DS[DepositService]
        AC[Adapter_AC]
        WS[WithdrawService]
    end

    subgraph OutboundPorts[Port Out]
        AR[AccountRepository]
        BP[BlockchainPort]
        BUP[BundlerPort]
        KP[KmsPort]
        MP[MessagePublisher]
    end

    subgraph OutboundAdapters[Adapter Out]
        REPO[PrismaAccountRepository]
        EBA[EthersBlockchainAdapter]
        BUA[ERC4337BundlerAdapter]
        MKA[MockKmsAdapter]
        NKA[NhnKmsAdapter]
        KPA[KafkaProducerAdapter]
    end

    KCA --> CAUC
    KCA --> CCUC
    KCA --> WUC
    WSA --> HDUC

    CAUC -.->|implements| AS
    HDUC -.->|implements| DS
    CCUC -.->|implements| AC
    WUC -.->|implements| WS

    AS --> AR
    AS --> BP
    AS --> KP
    AS --> MP
    DS --> AR
    DS --> MP
    AC --> BP
    AC --> MP
    WS --> AR
    WS --> BUP
    WS --> KP
    WS --> MP

    AR -.->|implements| REPO
    BP -.->|implements| EBA
    BUP -.->|implements| BUA
    KP -.->|implements| MKA
    KP -.->|implements| NKA
    MP -.->|implements| KPA
```

---

## 3. Kafka 메시지 흐름

```mermaid
graph LR
    WB[Wallet Backend]

    subgraph Subscribe[Subscribe - Inbound via Kafka]
        T1[adapter.account.create]
        T2[adapter.deposit.confirm]
        T3[adapter.withdraw.request]
        T4[adapter.withdraw.status]
    end

    subgraph Services
        AS[AccountService]
        DS[DepositService]
        AC[Adapter_AC]
        WS[WithdrawService]
    end

    subgraph Publish[Publish - Outbound via Kafka]
        T5[adapter.account.created]
        T6[adapter.deposit.detected]
        T7[adapter.deposit.confirmed]
        T8[adapter.withdraw.sent]
        T9[adapter.withdraw.confirmed]
    end

    DL[Deposit Listener - 별도 서비스]
    CHAIN[(Blockchain)]

    WB --> T1
    WB --> T2
    WB --> T3
    WB --> T4

    T1 --> AS
    T2 --> AC
    T3 --> WS
    T4 --> WS

    CHAIN --> DL
    DL -->|WebSocket Polling| DS

    AS --> T5
    DS --> T6
    AC --> T7
    WS --> T8
    WS --> T9

    T5 --> WB
    T6 --> WB
    T7 --> WB
    T8 --> WB
    T9 --> WB
```

---

## 4. Account 생성 시퀀스

```mermaid
sequenceDiagram
    participant WB as Wallet Backend
    participant K as Kafka
    participant KCA as KafkaConsumerAdapter
    participant AS as AccountService
    participant PR as PrismaAccountRepository
    participant KMS as KmsAdapter
    participant BC as BlockchainAdapter
    participant KPA as KafkaProducer

    WB->>K: produce(adapter.account.create)
    K->>KCA: consume message
    KCA->>KCA: requireFields(requestId, chain, salt)
    KCA->>AS: createAccount(req)
    AS->>PR: findBySalt(salt)
    alt salt already exists
        PR-->>AS: existing account
        AS->>KPA: publish(adapter.account.created)
    else new salt
        PR-->>AS: null
        AS->>KMS: getSigningKey()
        KMS-->>AS: owner public key
        AS->>BC: computeAddress(salt)
        BC-->>AS: CREATE2 address
        AS->>PR: save(account)
        PR-->>AS: saved
        AS->>KPA: publish(adapter.account.created)
    end
    KPA->>K: produce result
    K->>WB: consume(adapter.account.created)
```

---

## 5. 입금 감지 및 확인 시퀀스

```mermaid
sequenceDiagram
    participant CHAIN as Blockchain
    participant DL as Deposit Listener
    participant WSA as WebSocketAdapter
    participant DS as DepositService
    participant PR as PrismaAccountRepository
    participant KPA as KafkaProducer
    participant K as Kafka
    participant WB as Wallet Backend

    Note over CHAIN,DL: Phase 1 - 입금 감지 (외부 리스너)
    CHAIN->>DL: 블록 이벤트 (체인별 모니터링)
    DL->>WSA: WebSocket Polling (입금 감지 데이터)
    WSA->>DS: handleDeposit(event)
    DS->>PR: findByAddress(toAddress)
    alt address registered
        PR-->>DS: account found
        DS->>KPA: publish(adapter.deposit.detected)
        KPA->>K: produce
        K->>WB: deposit detected
    else address not registered
        PR-->>DS: null
        Note over DS: ignore - log only
    end
```

---

## 5-2. 컨펌 확인 시퀀스 (Adapter_AC)

```mermaid
sequenceDiagram
    participant WB as Wallet Backend
    participant K as Kafka
    participant AC as Adapter_AC
    participant BC as BlockchainAdapter
    participant RPC as EVM Node RPC
    participant KPA as KafkaProducer

    Note over WB,RPC: Phase 2 - 컨펌 확인 (백엔드 요청)
    WB->>K: produce(adapter.deposit.confirm)
    K->>AC: checkConfirm(req)
    AC->>BC: checkConfirmations(chain, txHash)
    BC->>RPC: getTransactionReceipt + getBlockNumber
    RPC-->>BC: receipt + block number
    BC-->>AC: confirmations count
    AC->>KPA: publish(adapter.deposit.confirmed)
    KPA->>K: produce
    K->>WB: deposit confirmed
```

---

## 6. 출금 (ERC-4337) 시퀀스

```mermaid
sequenceDiagram
    participant WB as Wallet Backend
    participant K as Kafka
    participant WS as WithdrawService
    participant PR as PrismaAccountRepository
    participant KMS as KmsAdapter
    participant BU as BundlerAdapter
    participant NODE as EVM Node RPC
    participant BSVC as Bundler Service
    participant CHAIN as Blockchain
    participant KPA as KafkaProducer

    Note over WB,CHAIN: Phase 1 - 출금 요청
    WB->>K: produce(adapter.withdraw.request)
    K->>WS: withdraw(req)
    WS->>PR: findByAddress(fromAddress)
    PR-->>WS: account
    WS->>KMS: getSigningKey()
    KMS-->>WS: owner key

    WS->>BU: buildUserOperation(params)
    Note over BU: encode callData ETH or ERC-20
    BU->>NODE: getCode(sender)
    NODE-->>BU: code (배포 여부 확인)
    Note over BU: set initCode if not deployed
    BU->>NODE: EntryPoint.getNonce(sender)
    NODE-->>BU: nonce
    BU->>BSVC: eth_estimateUserOperationGas(userOp)
    BSVC-->>BU: gas estimates
    BU->>NODE: getFeeData()
    NODE-->>BU: maxFeePerGas, maxPriorityFeePerGas
    Note over BU: compute userOpHash
    BU-->>WS: userOp + userOpHash

    WS->>KMS: sign(userOpHash)
    KMS-->>WS: signature
    WS->>BU: sendUserOperation(userOp)
    BU->>BSVC: eth_sendUserOperation(userOp)
    BSVC-->>BU: userOpHash
    BU-->>WS: userOpHash
    BSVC->>CHAIN: bundled tx submit
    WS->>KPA: publish(adapter.withdraw.sent)
    KPA->>K: produce
    K->>WB: withdraw sent

    Note over WB,CHAIN: Phase 2 - 상태 확인
    WB->>K: produce(adapter.withdraw.status)
    K->>WS: checkStatus(req)
    WS->>BU: getUserOperationReceipt(userOpHash)
    BU->>BSVC: eth_getUserOperationReceipt(userOpHash)
    BSVC-->>BU: receipt
    BU-->>WS: receipt (success/fail/pending)
    WS->>KPA: publish(adapter.withdraw.confirmed)
    KPA->>K: produce
    K->>WB: withdraw result
```

---

## 7. 에러 처리 흐름

```mermaid
graph TD
    REQ[Kafka Message 수신] --> VAL{requireFields 검증}
    VAL -->|실패| VE[ValidationError 로깅]
    VAL -->|성공| SVC[Service 메서드 호출]
    SVC --> WEH[withErrorHandling 래퍼]
    WEH --> EXEC{비즈니스 로직 실행}
    EXEC -->|성공| SR[successResponse 생성]
    SR --> PUB_OK[publish - 성공 토픽]
    EXEC -->|AppError| AE[errorResponse 생성]
    AE --> PUB_ERR[publish - 에러 토픽]
    EXEC -->|Unknown Error| UE[InfrastructureError 래핑]
    UE --> PUB_ERR

    subgraph AppError Hierarchy
        BASE[AppError]
        BASE --> VALE[ValidationError]
        BASE --> NFE[NotFoundError]
        BASE --> BE[BusinessError]
        BASE --> IE[InfrastructureError]
    end
```

---

## 8. 클래스 다이어그램

```mermaid
classDiagram
    class Account {
        +string id
        +string address
        +string chain
        +string salt
        +DateTime createdAt
    }

    class UserOperation {
        +string sender
        +string nonce
        +string callData
        +string callGasLimit
        +string verificationGasLimit
        +string preVerificationGas
        +string maxFeePerGas
        +string maxPriorityFeePerGas
        +string signature
        +string initCode
        +string paymasterAndData
    }

    class CreateAccountUseCase {
        <<interface>>
        +createAccount(req) Promise
    }

    class HandleDepositUseCase {
        <<interface>>
        +handleDeposit(event) Promise
    }

    class CheckConfirmUseCase {
        <<interface>>
        +checkConfirm(req) Promise
    }

    class WithdrawUseCase {
        <<interface>>
        +withdraw(req) Promise
        +checkStatus(req) Promise
    }

    class AccountRepository {
        <<interface>>
        +save(account) Promise
        +findByAddress(address) Promise
        +findBySalt(salt) Promise
    }

    class BlockchainPort {
        <<interface>>
        +computeAddress(salt) Promise
        +checkConfirmations(chain, txHash) Promise
    }

    class BundlerPort {
        <<interface>>
        +buildUserOperation(params) Promise
        +sendUserOperation(userOp) Promise
        +getUserOperationReceipt(hash) Promise
    }

    class KmsPort {
        <<interface>>
        +getSigningKey() Promise
        +sign(data) Promise
    }

    class MessagePublisher {
        <<interface>>
        +publish(topic, payload) Promise
    }

    class AccountService {
        -AccountRepository accountRepo
        -KmsPort kms
        -BlockchainPort blockchain
        -MessagePublisher publisher
    }

    class DepositService {
        -AccountRepository accountRepo
        -MessagePublisher publisher
    }

    class Adapter_AC {
        -BlockchainPort blockchain
        -MessagePublisher publisher
    }

    class WithdrawService {
        -AccountRepository accountRepo
        -BundlerPort bundler
        -KmsPort kms
        -MessagePublisher publisher
    }

    class PrismaAccountRepository {
        -PrismaClient prisma
        +save(account) Promise
        +findByAddress(address) Promise
        +findBySalt(salt) Promise
    }

    AccountService ..|> CreateAccountUseCase
    DepositService ..|> HandleDepositUseCase
    Adapter_AC ..|> CheckConfirmUseCase
    WithdrawService ..|> WithdrawUseCase

    AccountService --> AccountRepository
    AccountService --> KmsPort
    AccountService --> BlockchainPort
    AccountService --> MessagePublisher

    DepositService --> AccountRepository
    DepositService --> MessagePublisher

    Adapter_AC --> BlockchainPort
    Adapter_AC --> MessagePublisher

    WithdrawService --> AccountRepository
    WithdrawService --> BundlerPort
    WithdrawService --> KmsPort
    WithdrawService --> MessagePublisher

    PrismaAccountRepository ..|> AccountRepository
```

---

## 9. Prisma 기반 Persistence 구조

```mermaid
graph TB
    subgraph Application
        AS[AccountService]
        DS[DepositService]
        WS[WithdrawService]
    end

    subgraph Domain Port
        AR[AccountRepository - interface]
    end

    subgraph Adapter Out - Persistence
        PAR[PrismaAccountRepository]
        PC[PrismaClient]
        SCHEMA[prisma/schema.prisma]
    end

    subgraph Database
        PG[(PostgreSQL)]
    end

    AS --> AR
    DS --> AR
    WS --> AR
    AR -.->|implements| PAR
    PAR --> PC
    PC --> PG
    SCHEMA -.->|generates| PC
```

---

## 10. 디렉토리 구조

```mermaid
graph TD
    ROOT[src/] --> DOMAIN[domain/]
    ROOT --> APP[application/]
    ROOT --> ADAPTER[adapter/]
    ROOT --> CONFIG[config/]
    ROOT --> SHARED[shared/]
    ROOT --> ASYNC[asyncapi/]
    ROOT --> MAIN[app.ts]

    DOMAIN --> MODEL[model/]
    DOMAIN --> PORT[port/]
    MODEL --> ACC_M[Account.ts]
    MODEL --> UO_M[UserOperation.ts]
    PORT --> PIN[in/]
    PORT --> POUT[out/]
    PIN --> CAUC[CreateAccountUseCase.ts]
    PIN --> HDUC[HandleDepositUseCase.ts]
    PIN --> CCUC[CheckConfirmUseCase.ts]
    PIN --> WUC[WithdrawUseCase.ts]
    POUT --> AR[AccountRepository.ts]
    POUT --> BP[BlockchainPort.ts]
    POUT --> BUP[BundlerPort.ts]
    POUT --> KP[KmsPort.ts]
    POUT --> MP[MessagePublisher.ts]

    APP --> SUPPORT[support/]
    APP --> AS[AccountService.ts]
    APP --> DS[DepositService.ts]
    APP --> WS[WithdrawService.ts]
    SUPPORT --> WEH[withErrorHandling.ts]

    ADAPTER --> AIN[in/]
    ADAPTER --> AOUT[out/]
    AIN --> KAFKA_IN[kafka/KafkaConsumerAdapter.ts]
    AIN --> WS_IN[ws/WebSocketAdapter.ts]
    AOUT --> DB[persistence/]
    AOUT --> MSG[messaging/KafkaProducerAdapter.ts]
    AOUT --> BLOCK[blockchain/EthersBlockchainAdapter.ts]
    AOUT --> BUND[bundler/ERC4337BundlerAdapter.ts]
    AOUT --> KMS_OUT[kms/]
    DB --> SCHEMA[schema.prisma]
    DB --> REPO_IMPL[PrismaAccountRepository.ts]
    KMS_OUT --> MOCK[MockKmsAdapter.ts]
    KMS_OUT --> NHN[NhnKmsAdapter.ts]

    SHARED --> ERR[errors.ts]
    SHARED --> VAL[validation.ts]
    SHARED --> RES[response.ts]

    CONFIG --> CFG[index.ts]
    CONFIG --> DBCFG[database.ts]
    CONFIG --> KCFG[kafka.ts]
```

---

## 11. 유스케이스별 아키텍처

### 11-1. 첫 계정 생성 (Account Creation)

```mermaid
graph LR
    WB[Wallet Backend] -->|adapter.account.create| KAFKA[(Kafka)]
    KAFKA --> KCA[KafkaConsumerAdapter]

    subgraph BC_Adapter
        KCA --> AS[AccountService]
        AS -->|1. findBySalt 중복확인| REPO[PrismaAccountRepository]
        REPO --> PG[(PostgreSQL)]
        AS -->|2. getSigningKey| KMS[KmsAdapter]
        KMS --> NHNKMS[NHN Cloud KMS]
        AS -->|3. computeAddress CREATE2| BC[EthersBlockchainAdapter]
        BC --> RPC[EVM Node RPC]
        AS -->|4. save| REPO
        AS -->|5. publish 결과| KPA[KafkaProducerAdapter]
    end

    KPA -->|adapter.account.created| KAFKA2[(Kafka)]
    KAFKA2 --> WB2[Wallet Backend]
```

```mermaid
sequenceDiagram
    participant WB as Wallet Backend
    participant K as Kafka
    participant AS as AccountService
    participant DB as Prisma DB
    participant KMS as KMS
    participant BC as Blockchain RPC

    WB->>K: adapter.account.create
    Note over K: requestId, chain, salt

    K->>AS: createAccount(req)
    AS->>DB: findBySalt(salt)

    alt 이미 존재하는 salt (멱등성)
        DB-->>AS: existing account
        AS->>K: adapter.account.created (기존 address)
    else 새로운 salt
        DB-->>AS: null
        AS->>KMS: getSigningKey()
        KMS-->>AS: owner public key

        Note over AS,BC: CREATE2 주소 계산
        AS->>BC: computeAddress(salt)
        Note over BC: keccak256(0xff + factory + saltHash + initCodeHash)
        BC-->>AS: computed address

        AS->>DB: save(id, address, chain, salt)
        DB-->>AS: saved
        AS->>K: adapter.account.created (new address)
    end

    K->>WB: 결과 수신
```

---

### 11-2. 입금 (Deposit Detection + Confirmation)

```mermaid
graph LR
    CHAIN[(Blockchain)] -->|블록 이벤트| DL

    subgraph Listener[Deposit Listener - 별도 서비스]
        DL[체인별 Listener]
    end

    DL -->|WebSocket Polling| WSA

    subgraph BC_Adapter
        WSA[WebSocketAdapter] --> DS[DepositService]
        DS -->|1. findByAddress| REPO[PrismaAccountRepository]
        REPO --> PG[(PostgreSQL)]
        DS -->|2. publish 감지| KPA[KafkaProducerAdapter]
    end

    KPA -->|adapter.deposit.detected| KAFKA[(Kafka)]
    KAFKA --> WB[Wallet Backend]

    WB -->|adapter.deposit.confirm| KAFKA2[(Kafka)]
    KAFKA2 --> KCA[KafkaConsumerAdapter]

    subgraph BC_Adapter_AC[BC_Adapter - 컨펌]
        KCA --> AC[Adapter_AC]
        AC -->|checkConfirmations| BC[EthersBlockchainAdapter]
        BC --> RPC[EVM Node RPC]
        AC --> KPA2[KafkaProducerAdapter]
    end

    KPA2 -->|adapter.deposit.confirmed| KAFKA3[(Kafka)]
    KAFKA3 --> WB2[Wallet Backend]
```

```mermaid
sequenceDiagram
    participant CHAIN as Blockchain
    participant DL as Deposit Listener
    participant DS as DepositService
    participant DB as Prisma DB
    participant K as Kafka
    participant WB as Wallet Backend
    participant AC as Adapter_AC
    participant RPC as EVM Node RPC

    Note over CHAIN,DL: Step 1 - 입금 감지
    CHAIN->>DL: 새 블록/트랜잭션 이벤트
    Note over DL: 체인별(ETH, Polygon, Sepolia) 모니터링
    DL->>DS: WebSocket Polling (txHash, toAddress, amount, chain)

    DS->>DB: findByAddress(toAddress)
    alt 등록된 주소
        DB-->>DS: account found
        DS->>K: adapter.deposit.detected
        Note over K: txHash, toAddress, amount, chain
        K->>WB: 입금 감지 알림
    else 미등록 주소
        DB-->>DS: null
        Note over DS: skip (우리 주소가 아님)
    end

    Note over WB,RPC: Step 2 - 컨펌 확인
    WB->>K: adapter.deposit.confirm
    Note over K: requestId, txHash, chain
    K->>AC: checkConfirm(req)
    AC->>RPC: getTransactionReceipt(txHash)
    RPC-->>AC: receipt (blockNumber)
    AC->>RPC: getBlockNumber()
    RPC-->>AC: latest block
    Note over AC: confirmations = latest - tx block
    AC->>K: adapter.deposit.confirmed
    Note over K: requestId, txHash, confirmations
    K->>WB: 컨펌 결과
```

---

### 11-3. 출금 (Withdraw via ERC-4337)

```mermaid
graph LR
    WB[Wallet Backend] -->|adapter.withdraw.request| KAFKA[(Kafka)]
    KAFKA --> KCA[KafkaConsumerAdapter]

    subgraph BC_Adapter
        KCA --> WS[WithdrawService]
        WS -->|1. findByAddress| REPO[PrismaAccountRepository]
        REPO --> PG[(PostgreSQL)]
        WS -->|2. getSigningKey| KMS[KmsAdapter]
        KMS --> NHNKMS[NHN Cloud KMS]
        WS -->|3. buildUserOp| BU[ERC4337BundlerAdapter]
        BU -->|getCode, getNonce, getFeeData| NODE[EVM Node RPC]
        BU -->|estimateGas| BSVC[Bundler Service]
        WS -->|4. sign userOpHash| KMS
        WS -->|5. sendUserOp| BU
        BU -->|eth_sendUserOperation| BSVC
        BSVC -->|bundled tx| CHAIN[(Blockchain)]
        WS -->|6. publish 결과| KPA[KafkaProducerAdapter]
    end

    KPA -->|adapter.withdraw.sent| KAFKA2[(Kafka)]
    KAFKA2 --> WB2[Wallet Backend]
```

```mermaid
sequenceDiagram
    participant WB as Wallet Backend
    participant K as Kafka
    participant WS as WithdrawService
    participant DB as Prisma DB
    participant KMS as KMS
    participant NODE as EVM Node RPC
    participant BSVC as Bundler Service
    participant CHAIN as Blockchain

    Note over WB,CHAIN: 출금 요청 (ETH 전송)
    WB->>K: adapter.withdraw.request
    Note over K: requestId, chain, fromAddress, toAddress, amount, token=ETH
    K->>WS: withdraw(req)

    WS->>DB: findByAddress(fromAddress)
    DB-->>WS: account (address, salt)

    WS->>KMS: getSigningKey()
    KMS-->>WS: owner address

    Note over WS,BSVC: UserOperation 빌드
    WS->>NODE: getCode(sender)
    NODE-->>WS: code
    alt 미배포 계정
        Note over WS: initCode = factory + createAccount(owner, salt)
    else 배포된 계정
        Note over WS: initCode = 0x
    end

    WS->>NODE: EntryPoint.getNonce(sender, 0)
    NODE-->>WS: nonce

    Note over WS: callData = execute(toAddress, amount, 0x)
    WS->>BSVC: eth_estimateUserOperationGas(userOp)
    BSVC-->>WS: callGasLimit, verificationGasLimit, preVerificationGas

    WS->>NODE: getFeeData()
    NODE-->>WS: maxFeePerGas, maxPriorityFeePerGas

    Note over WS: userOpHash = keccak256(packed userOp + entryPoint + chainId)

    WS->>KMS: sign(userOpHash)
    KMS-->>WS: signature

    WS->>BSVC: eth_sendUserOperation(userOp)
    BSVC-->>WS: userOpHash
    BSVC->>CHAIN: bundled transaction

    WS->>K: adapter.withdraw.sent
    Note over K: requestId, userOpHash
    K->>WB: 출금 전송 완료

    Note over WB,CHAIN: 상태 확인
    WB->>K: adapter.withdraw.status
    K->>WS: checkStatus(req)
    WS->>BSVC: eth_getUserOperationReceipt(userOpHash)
    BSVC-->>WS: receipt (success, txHash, gasCost)
    WS->>K: adapter.withdraw.confirmed
    K->>WB: 최종 결과
```

---

### 11-4. 결제 (Payment - ERC-20 토큰 전송)

```mermaid
graph LR
    WB[Wallet Backend] -->|adapter.withdraw.request| KAFKA[(Kafka)]
    KAFKA --> KCA[KafkaConsumerAdapter]

    subgraph BC_Adapter
        KCA --> WS[WithdrawService]
        WS -->|1. findByAddress| REPO[PrismaAccountRepository]
        REPO --> PG[(PostgreSQL)]
        WS -->|2. getSigningKey| KMS[KmsAdapter]
        KMS --> NHNKMS[NHN Cloud KMS]
        WS -->|3. buildUserOp ERC-20| BU[ERC4337BundlerAdapter]
        BU -->|getCode, getNonce, getFeeData| NODE[EVM Node RPC]
        BU -->|estimateGas| BSVC[Bundler Service]
        WS -->|4. sign userOpHash| KMS
        WS -->|5. sendUserOp| BU
        BU -->|eth_sendUserOperation| BSVC
        BSVC -->|bundled tx| CHAIN[(Blockchain)]
        WS -->|6. publish 결과| KPA[KafkaProducerAdapter]
    end

    KPA -->|adapter.withdraw.sent| KAFKA2[(Kafka)]
    KAFKA2 --> WB2[Wallet Backend]
```

```mermaid
sequenceDiagram
    participant WB as Wallet Backend
    participant K as Kafka
    participant WS as WithdrawService
    participant DB as Prisma DB
    participant KMS as KMS
    participant NODE as EVM Node RPC
    participant BSVC as Bundler Service
    participant CHAIN as Blockchain

    Note over WB,CHAIN: 결제 요청 (ERC-20 토큰 전송 to 가맹점)
    WB->>K: adapter.withdraw.request
    Note over K: requestId, chain, fromAddress, toAddress=가맹점, amount, token=0xTokenAddr
    K->>WS: withdraw(req)

    WS->>DB: findByAddress(fromAddress)
    DB-->>WS: account (address, salt)

    WS->>KMS: getSigningKey()
    KMS-->>WS: owner address

    Note over WS,BSVC: UserOperation 빌드 (ERC-20)
    WS->>NODE: getCode(sender)
    NODE-->>WS: code
    WS->>NODE: EntryPoint.getNonce(sender, 0)
    NODE-->>WS: nonce

    Note over WS: ERC-20 callData 인코딩
    Note over WS: innerCall = token.transfer(가맹점, amount)
    Note over WS: callData = execute(tokenAddr, 0, innerCall)

    WS->>BSVC: eth_estimateUserOperationGas(userOp)
    BSVC-->>WS: gas estimates

    WS->>NODE: getFeeData()
    NODE-->>WS: gas prices

    Note over WS: userOpHash 계산
    WS->>KMS: sign(userOpHash)
    KMS-->>WS: signature

    WS->>BSVC: eth_sendUserOperation(userOp)
    BSVC-->>WS: userOpHash
    BSVC->>CHAIN: bundled transaction
    Note over CHAIN: EntryPoint.handleOps() 실행
    Note over CHAIN: Account.execute() 호출
    Note over CHAIN: ERC20.transfer(가맹점, amount) 실행

    WS->>K: adapter.withdraw.sent
    K->>WB: 결제 전송 완료

    Note over WB,CHAIN: 결제 상태 확인
    WB->>K: adapter.withdraw.status
    K->>WS: checkStatus(req)
    WS->>BSVC: eth_getUserOperationReceipt(userOpHash)
    BSVC-->>WS: receipt
    WS->>K: adapter.withdraw.confirmed
    K->>WB: 결제 최종 결과
```
