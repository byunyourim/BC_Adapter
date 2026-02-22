import {
  JsonRpcProvider,
  Contract,
  Interface,
  AbiCoder,
  keccak256,
  concat,
  toBeHex,
} from "ethers";
import { UserOperation } from "../../../domain/model/UserOperation";
import {
  BundlerPort,
  UserOperationReceipt,
} from "../../../domain/port/out/BundlerPort";

const ERC20_TRANSFER_ABI = ["function transfer(address to, uint256 amount)"];

const ACCOUNT_FACTORY_ABI = [
  "function createAccount(address owner, uint256 salt) returns (address)",
];

const ENTRY_POINT_ABI = [
  "function getNonce(address sender, uint192 key) view returns (uint256)",
];

const EXECUTE_ABI = [
  "function execute(address dest, uint256 value, bytes calldata func)",
];

interface BundlerConfig {
  rpcUrls: Record<string, string>;
  nodeRpcUrls: Record<string, string>;
  entryPointAddress: string;
  accountFactoryAddress: string;
}

export class ERC4337BundlerAdapter implements BundlerPort {
  private readonly bundlerProviders = new Map<string, JsonRpcProvider>();
  private readonly nodeProviders = new Map<string, JsonRpcProvider>();
  private readonly erc20Interface = new Interface(ERC20_TRANSFER_ABI);
  private readonly executeInterface = new Interface(EXECUTE_ABI);
  private readonly factoryInterface = new Interface(ACCOUNT_FACTORY_ABI);

  constructor(private readonly bundlerConfig: BundlerConfig) {}

  async buildUserOperation(params: {
    chain: string;
    sender: string;
    toAddress: string;
    amount: string;
    token: string;
    ownerAddress: string;
    salt: string;
  }): Promise<{ userOp: UserOperation; userOpHash: string }> {
    const { chain, sender, toAddress, amount, token, ownerAddress, salt } =
      params;
    const bundlerProvider = this.getBundlerProvider(chain);
    const nodeProvider = this.getNodeProvider(chain);

    // 1. callData 인코딩: ETH 전송 vs ERC-20 전송
    let callData: string;
    if (token.toUpperCase() === "ETH") {
      callData = this.executeInterface.encodeFunctionData("execute", [
        toAddress,
        amount,
        "0x",
      ]);
    } else {
      const transferData = this.erc20Interface.encodeFunctionData("transfer", [
        toAddress,
        amount,
      ]);
      callData = this.executeInterface.encodeFunctionData("execute", [
        token,
        0,
        transferData,
      ]);
    }

    // 2. 계정 배포 여부 확인 → initCode 결정
    const code = await nodeProvider.getCode(sender);
    const isDeployed = code !== "0x";

    let initCode = "0x";
    if (!isDeployed) {
      const saltHash = keccak256(
        AbiCoder.defaultAbiCoder().encode(["string"], [salt]),
      );
      const factoryCallData = this.factoryInterface.encodeFunctionData(
        "createAccount",
        [ownerAddress, saltHash],
      );
      initCode = concat([
        this.bundlerConfig.accountFactoryAddress,
        factoryCallData,
      ]);
    }

    // 3. EntryPoint에서 nonce 조회
    const entryPoint = new Contract(
      this.bundlerConfig.entryPointAddress,
      ENTRY_POINT_ABI,
      nodeProvider,
    );
    const nonce: bigint = await entryPoint.getNonce(sender, 0);

    // 4. UserOp 구성
    const userOp: UserOperation = {
      sender,
      nonce: toBeHex(nonce),
      callData,
      callGasLimit: "0x0",
      verificationGasLimit: "0x0",
      preVerificationGas: "0x0",
      maxFeePerGas: "0x0",
      maxPriorityFeePerGas: "0x0",
      signature: "0x",
      initCode,
      paymasterAndData: "0x",
    };

    // 5. 번들러에 gas 추정 요청
    const gasEstimate = await bundlerProvider.send(
      "eth_estimateUserOperationGas",
      [userOp, this.bundlerConfig.entryPointAddress],
    );

    userOp.callGasLimit = gasEstimate.callGasLimit;
    userOp.verificationGasLimit = gasEstimate.verificationGasLimit;
    userOp.preVerificationGas = gasEstimate.preVerificationGas;

    // 6. gas price 설정
    const feeData = await nodeProvider.getFeeData();
    userOp.maxFeePerGas = "0x" + (feeData.maxFeePerGas ?? 0n).toString(16);
    userOp.maxPriorityFeePerGas =
      "0x" + (feeData.maxPriorityFeePerGas ?? 0n).toString(16);

    // 7. userOpHash 계산
    const userOpHash = this.computeUserOpHash(userOp, chain);

    return { userOp, userOpHash };
  }

  async sendUserOperation(
    chain: string,
    userOp: UserOperation,
  ): Promise<string> {
    const provider = this.getBundlerProvider(chain);
    const userOpHash: string = await provider.send(
      "eth_sendUserOperation",
      [userOp, this.bundlerConfig.entryPointAddress],
    );
    return userOpHash;
  }

  async getUserOperationReceipt(
    chain: string,
    userOpHash: string,
  ): Promise<UserOperationReceipt | null> {
    const provider = this.getBundlerProvider(chain);
    const receipt = await provider.send("eth_getUserOperationReceipt", [
      userOpHash,
    ]);

    if (!receipt) return null;

    return {
      userOpHash: receipt.userOpHash,
      success: receipt.receipt?.status === "0x1",
      actualGasCost: receipt.actualGasCost ?? "0x0",
      actualGasUsed: receipt.actualGasUsed ?? "0x0",
      txHash: receipt.receipt?.transactionHash ?? "",
    };
  }

  private computeUserOpHash(userOp: UserOperation, chain: string): string {
    const abiCoder = AbiCoder.defaultAbiCoder();
    const packed = abiCoder.encode(
      [
        "address",
        "uint256",
        "bytes32",
        "bytes32",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
        "bytes32",
      ],
      [
        userOp.sender,
        userOp.nonce,
        keccak256(userOp.initCode),
        keccak256(userOp.callData),
        userOp.callGasLimit,
        userOp.verificationGasLimit,
        userOp.preVerificationGas,
        userOp.maxFeePerGas,
        userOp.maxPriorityFeePerGas,
        keccak256(userOp.paymasterAndData),
      ],
    );

    const chainId = this.getChainId(chain);
    const encoded = abiCoder.encode(
      ["bytes32", "address", "uint256"],
      [
        keccak256(packed),
        this.bundlerConfig.entryPointAddress,
        chainId,
      ],
    );

    return keccak256(encoded);
  }

  private getChainId(chain: string): number {
    const chainIds: Record<string, number> = {
      ethereum: 1,
      sepolia: 11155111,
      polygon: 137,
    };
    const id = chainIds[chain];
    if (id === undefined) throw new Error(`Unknown chain: ${chain}`);
    return id;
  }

  private getBundlerProvider(chain: string): JsonRpcProvider {
    const existing = this.bundlerProviders.get(chain);
    if (existing) return existing;

    const url = this.bundlerConfig.rpcUrls[chain];
    if (!url)
      throw new Error(`No bundler RPC URL configured for chain: ${chain}`);

    const provider = new JsonRpcProvider(url);
    this.bundlerProviders.set(chain, provider);
    return provider;
  }

  private getNodeProvider(chain: string): JsonRpcProvider {
    const existing = this.nodeProviders.get(chain);
    if (existing) return existing;

    const url = this.bundlerConfig.nodeRpcUrls[chain];
    if (!url)
      throw new Error(`No node RPC URL configured for chain: ${chain}`);

    const provider = new JsonRpcProvider(url);
    this.nodeProviders.set(chain, provider);
    return provider;
  }
}
