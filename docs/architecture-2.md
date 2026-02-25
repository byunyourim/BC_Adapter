# BC_Adapter 유스케이스별 흐름 (Simplified View)

> Wallet Backend ↔ BC_Adaptor 간 외부 시스템 관점의 간략화된 흐름도

---

## 1. 첫 계정 생성 (Account Creation)

### Flowchart

```mermaid
flowchart LR

W[WalletBE] -->|1 account.create.REQ| K[(Kafka)]
K -->|2 account.create.REQ| A

subgraph BCA[BC_Adaptor]
direction TB
A[Core]
KMS[KMS Interface]
end

subgraph Infra[Infrastructure]
direction TB
NHN[(NHN_KMS)]
DB[(PostgreSQL)]
end

A -->|3 getKey.REQ| KMS
KMS -->|4 REST API| NHN
NHN -->|5 owner key| KMS
KMS -->|6 owner key| A

A -->|7 CREATE2 사전주소 계산| A
A -->|8 insert address| DB

A -->|9 account.created| K
K -->|9 account.created| W
```

### Sequence Diagram

```mermaid
sequenceDiagram
    participant W as WalletBE
    participant K as Kafka

    box BC_ADAPTOR_SERVICE
        participant C as Core
    end

    box Infrastructure
        participant KMS as NHN_KMS
        participant DB as PostgreSQL
    end

    W->>K: 1 account.create.REQ
    K->>C: 2 account.create.REQ
    Note over C: requestId, chain, salt

    C->>C: 3 findBySalt(salt) 중복 확인

    alt salt 이미 존재 (멱등성)
        C-->>K: account.created (기존 address)
        K-->>W: account.created delivered
    else 새로운 salt
        C->>KMS: 4 REST 키 서명 요청 (getSigningKey)
        KMS-->>C: 5 owner key

        Note over C: 6 CREATE2 사전주소 계산 (내부)
        Note over C: keccak256(0xff + factory + saltHash + initCodeHash)

        C->>DB: 7 insert(address, chain, salt)
        DB-->>C: 8 saved

        C-->>K: 9 account.created`.RES` (new address)
        K-->>W: account.created.RES delivered
    end
```

---

## 2. 입금 (Deposit Detection + Confirmation)

### Flowchart

```mermaid
flowchart LR

subgraph Chains[Chains]
direction TB
ETH[Ethereum]
AVA[Avalanche]
KCP[KCP_Subnet]
end

ETH -->|1 블록 이벤트| DL[Deposit Listener]
AVA -->|1 블록 이벤트| DL
KCP -->|1 블록 이벤트| DL

DL -->|2 WebSocket| A

subgraph BCA[BC_Adaptor]
direction TB
A[Core]
AC[BC_AC Adaptor_Check]
end

A -->|3 deposit.detected| K[(Kafka)]
K -->|3 deposit.detected| W[WalletBE]

W -->|4 confirm.REQ| K
K -->|5 confirm.REQ| A

A -->|6 confirm check| AC
AC -->|7 rpc| ETH
AC -->|7 rpc| AVA
AC -->|7 rpc| KCP

A -->|8 confirm.RES| K
K -->|8 confirm.RES| W
```

### Sequence Diagram

```mermaid
sequenceDiagram
    participant W as WalletBE
    participant K as Kafka
    participant DL as Deposit Listener

    box BC_ADAPTOR_SERVICE
        participant C as Core
        participant AC as BC_AC(Check)
    end

    box Chains
        participant ETH as Ethereum
        participant AVA as Avalanche
        participant KCP as KCP_Subnet
    end

    Note over ETH,DL: Phase 1 - 입금 감지

    ETH->>DL: 1 블록 이벤트
    AVA->>DL: 1 블록 이벤트
    KCP->>DL: 1 블록 이벤트
    DL->>C: 2 WebSocket (txHash, toAddress, amount, chain)

    C->>C: 3 findByAddress(toAddress)

    alt 등록된 주소
        C-->>K: 4 deposit.detected
        Note over K: txHash, toAddress, amount, chain
        K-->>W: deposit.detected delivered
    else 미등록 주소
        Note over C: skip - log only
    end

    Note over W,KCP: Phase 2 - 컨펌 확인

    W->>K: 5 confirm.REQ
    Note over K: requestId, txHash, chain
    K->>C: 6 confirm.REQ

    C->>AC: 7 check confirmation
    AC->>ETH: 8 getTransactionReceipt(txHash)
    ETH-->>AC: 9 receipt (blockNumber)
    AC->>ETH: 10 getBlockNumber()
    ETH-->>AC: 11 latest block
    Note over AC: confirmations = latest - txBlock
    Note over AC: (해당 체인의 RPC로 요청)

    AC-->>C: 12 confirm count

    C-->>K: 13 confirm.RES
    K-->>W: confirm.RES delivered
```
