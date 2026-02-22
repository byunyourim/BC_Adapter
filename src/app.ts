import { AppDataSource } from "./config/database";
import { config } from "./config/index";
import { kafka } from "./config/kafka";

import { TypeOrmAccountRepository } from "./adapter/out/persistence/TypeOrmAccountRepository";
import { KafkaProducerAdapter } from "./adapter/out/messaging/KafkaProducerAdapter";
import { EthersBlockchainAdapter } from "./adapter/out/blockchain/EthersBlockchainAdapter";
import { NhnKmsAdapter } from "./adapter/out/kms/NhnKmsAdapter";
import { MockKmsAdapter } from "./adapter/out/kms/MockKmsAdapter";
import { ERC4337BundlerAdapter } from "./adapter/out/bundler/ERC4337BundlerAdapter";

import { AccountService } from "./application/AccountService";
import { DepositService } from "./application/DepositService";
import { WithdrawService } from "./application/WithdrawService";

import { KafkaConsumerAdapter } from "./adapter/in/kafka/KafkaConsumerAdapter";
import { WebSocketAdapter } from "./adapter/in/websocket/WebSocketAdapter";
import { requireFields } from "./shared/validation";

let kafkaConsumer: KafkaConsumerAdapter;
let webSocket: WebSocketAdapter;
let kafkaProducer: ReturnType<typeof kafka.producer>;

async function main(): Promise<void> {
  console.log("[App] Starting BC Adapter...");

  // 1. DB 연결
  await AppDataSource.initialize();
  console.log("[App] Database connected");

  // 2. Outbound 어댑터 생성
  const accountRepo = new TypeOrmAccountRepository(AppDataSource);

  kafkaProducer = kafka.producer();
  await kafkaProducer.connect();
  console.log("[Kafka] Producer connected");
  const publisher = new KafkaProducerAdapter(kafkaProducer);

  const blockchain = new EthersBlockchainAdapter({
    rpcUrls: {
      ethereum: config.rpc.ethereum,
      polygon: config.rpc.polygon,
      sepolia: config.rpc.sepolia,
    },
    factoryAddress: config.blockchain.factoryAddress,
    initCodeHash: config.blockchain.initCodeHash,
    requiredConfirmations: config.blockchain.requiredConfirmations,
  });

  const kms = process.env.USE_MOCK_KMS === "true"
    ? new MockKmsAdapter(process.env.MOCK_KMS_PRIVATE_KEY)
    : new NhnKmsAdapter(config.kms);

  const bundler = new ERC4337BundlerAdapter({
    rpcUrls: {
      ethereum: config.bundler.ethereum,
      polygon: config.bundler.polygon,
      sepolia: config.bundler.sepolia,
    },
    nodeRpcUrls: {
      ethereum: config.rpc.ethereum,
      polygon: config.rpc.polygon,
      sepolia: config.rpc.sepolia,
    },
    entryPointAddress: config.bundler.entryPointAddress,
    accountFactoryAddress: config.bundler.accountFactoryAddress,
  });

  // 3. Application 서비스 생성 (포트 주입)
  const accountService = new AccountService(accountRepo, kms, blockchain, publisher);
  const depositService = new DepositService(accountRepo, blockchain, publisher);
  const withdrawService = new WithdrawService(accountRepo, bundler, kms, publisher);

  // 4. Inbound 어댑터 생성 (토픽별 핸들러 등록)
  kafkaConsumer = new KafkaConsumerAdapter(
    kafka.consumer({ groupId: config.kafka.groupId }),
  );

  kafkaConsumer.register("adapter.account.create", async (data) => {
    requireFields(data, ["requestId", "chain", "salt"]);
    await accountService.createAccount(
      data as { requestId: string; chain: string; salt: string },
    );
  });

  kafkaConsumer.register("adapter.deposit.confirm", async (data) => {
    requireFields(data, ["requestId", "txHash", "chain"]);
    await depositService.checkConfirm(
      data as { requestId: string; txHash: string; chain: string },
    );
  });

  kafkaConsumer.register("adapter.withdraw.request", async (data) => {
    requireFields(data, ["requestId", "chain", "fromAddress", "toAddress", "amount", "token"]);
    await withdrawService.withdraw(
      data as {
        requestId: string;
        chain: string;
        fromAddress: string;
        toAddress: string;
        amount: string;
        token: string;
      },
    );
  });

  kafkaConsumer.register("adapter.withdraw.status", async (data) => {
    requireFields(data, ["requestId", "chain", "userOpHash"]);
    await withdrawService.checkStatus(
      data as { requestId: string; chain: string; userOpHash: string },
    );
  });

  await kafkaConsumer.start();

  webSocket = new WebSocketAdapter(config.ws.port, depositService);
  webSocket.start();

  console.log("[App] BC Adapter is running");
}

async function shutdown(): Promise<void> {
  console.log("[App] Shutting down...");
  webSocket?.stop();
  await kafkaConsumer?.stop();
  await kafkaProducer?.disconnect();
  await AppDataSource.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[App] Failed to start:", err);
  process.exit(1);
});
