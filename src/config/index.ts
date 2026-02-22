import dotenv from "dotenv";

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env variable: ${key}`);
  return value;
}

export const config = {
  db: {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 5432),
    username: required("DB_USERNAME"),
    password: required("DB_PASSWORD"),
    database: required("DB_DATABASE"),
  },
  kafka: {
    brokers: required("KAFKA_BROKERS").split(","),
    clientId: process.env.KAFKA_CLIENT_ID ?? "bc-adapter",
    groupId: process.env.KAFKA_GROUP_ID ?? "bc-adapter-group",
  },
  rpc: {
    ethereum: process.env.ETH_RPC_URL ?? "",
    polygon: process.env.POLYGON_RPC_URL ?? "",
    sepolia: process.env.SEPOLIA_RPC_URL ?? "",
  },
  blockchain: {
    requiredConfirmations: Number(process.env.REQUIRED_CONFIRMATIONS ?? 12),
    factoryAddress: required("CREATE2_FACTORY_ADDRESS"),
    initCodeHash: required("CREATE2_INIT_CODE_HASH"),
  },
  kms: process.env.USE_MOCK_KMS === "true"
    ? { appKey: "", secretKey: "", keyId: "", endpoint: "" }
    : {
        appKey: required("NHN_KMS_APP_KEY"),
        secretKey: required("NHN_KMS_SECRET_KEY"),
        keyId: required("NHN_KMS_KEY_ID"),
        endpoint: required("NHN_KMS_ENDPOINT"),
      },
  bundler: {
    ethereum: process.env.ETH_BUNDLER_URL ?? "",
    polygon: process.env.POLYGON_BUNDLER_URL ?? "",
    sepolia: process.env.SEPOLIA_BUNDLER_URL ?? "",
    entryPointAddress: required("ENTRY_POINT_ADDRESS"),
    accountFactoryAddress: required("ACCOUNT_FACTORY_ADDRESS"),
  },
  ws: {
    port: Number(process.env.WS_PORT ?? 8080),
  },
};
