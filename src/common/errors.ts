export const ErrorCode = {
  // Validation
  VALIDATION_ERROR: "VALIDATION_ERROR",
  MISSING_REQUIRED_FIELDS: "MISSING_REQUIRED_FIELDS",
  UNSUPPORTED_CHAIN: "UNSUPPORTED_CHAIN",

  // Not Found
  NOT_FOUND: "NOT_FOUND",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",

  // Infrastructure - KMS
  KMS_KEY_RETRIEVAL_FAILED: "KMS_KEY_RETRIEVAL_FAILED",
  KMS_SIGNING_FAILED: "KMS_SIGNING_FAILED",

  // Infrastructure - Blockchain RPC
  RPC_CONNECTION_FAILED: "RPC_CONNECTION_FAILED",
  RPC_NOT_CONFIGURED: "RPC_NOT_CONFIGURED",

  // Infrastructure - Bundler
  BUNDLER_BUILD_FAILED: "BUNDLER_BUILD_FAILED",
  BUNDLER_SEND_FAILED: "BUNDLER_SEND_FAILED",
  BUNDLER_RECEIPT_FAILED: "BUNDLER_RECEIPT_FAILED",
  BUNDLER_NOT_CONFIGURED: "BUNDLER_NOT_CONFIGURED",

  // Infrastructure - DB
  DB_SAVE_FAILED: "DB_SAVE_FAILED",
  DB_QUERY_FAILED: "DB_QUERY_FAILED",

  // Business
  BUSINESS_ERROR: "BUSINESS_ERROR",

  // Unknown
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export const ErrorMessage: Record<string, string> = {
  // Validation
  [ErrorCode.VALIDATION_ERROR]: "Validation failed",
  [ErrorCode.MISSING_REQUIRED_FIELDS]: "Required fields are missing",
  [ErrorCode.UNSUPPORTED_CHAIN]: "The specified blockchain chain is not supported",

  // Not Found
  [ErrorCode.NOT_FOUND]: "Requested resource not found",
  [ErrorCode.ACCOUNT_NOT_FOUND]: "Account is not registered",

  // Infrastructure - KMS
  [ErrorCode.KMS_KEY_RETRIEVAL_FAILED]: "Failed to retrieve signing key from KMS",
  [ErrorCode.KMS_SIGNING_FAILED]: "Failed to sign data via KMS",

  // Infrastructure - Blockchain RPC
  [ErrorCode.RPC_CONNECTION_FAILED]: "Blockchain RPC connection failed",
  [ErrorCode.RPC_NOT_CONFIGURED]: "RPC URL is not configured for the chain",

  // Infrastructure - Bundler
  [ErrorCode.BUNDLER_BUILD_FAILED]: "Failed to build UserOperation",
  [ErrorCode.BUNDLER_SEND_FAILED]: "Failed to send UserOperation to bundler",
  [ErrorCode.BUNDLER_RECEIPT_FAILED]: "Failed to retrieve UserOperation receipt",
  [ErrorCode.BUNDLER_NOT_CONFIGURED]: "Bundler URL is not configured for the chain",

  // Infrastructure - DB
  [ErrorCode.DB_SAVE_FAILED]: "Failed to save data to database",
  [ErrorCode.DB_QUERY_FAILED]: "Failed to query data from database",

  // Business
  [ErrorCode.BUSINESS_ERROR]: "Business logic error occurred",

  // Unknown
  [ErrorCode.UNKNOWN_ERROR]: "An unexpected error occurred",
};

function resolveMessage(code: string, detail?: string): string {
  const base = ErrorMessage[code] ?? code;
  return detail ? `${base}: ${detail}` : base;
}

export class AppError extends Error {
  public readonly code: string;

  constructor(code: string, detail?: string) {
    super(resolveMessage(code, detail));
    this.code = code;
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(code: string = ErrorCode.VALIDATION_ERROR, detail?: string) {
    super(code, detail);
  }
}

export class NotFoundError extends AppError {
  constructor(code: string = ErrorCode.NOT_FOUND, detail?: string) {
    super(code, detail);
  }
}

export class BusinessError extends AppError {
  constructor(code: string = ErrorCode.BUSINESS_ERROR, detail?: string) {
    super(code, detail);
  }
}

export class InfrastructureError extends AppError {
  constructor(code: string = ErrorCode.UNKNOWN_ERROR, detail?: string) {
    super(code, detail);
  }
}

export function wrapInfraError(
  error: unknown,
  code: string,
): never {
  if (error instanceof AppError) throw error;
  const detail = error instanceof Error ? error.message : String(error);
  throw new InfrastructureError(code, detail);
}
