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

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code: string = ErrorCode.VALIDATION_ERROR) {
    super(message, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code: string = ErrorCode.NOT_FOUND) {
    super(message, code);
  }
}

export class BusinessError extends AppError {
  constructor(message: string, code: string = ErrorCode.BUSINESS_ERROR) {
    super(message, code);
  }
}

export class InfrastructureError extends AppError {
  constructor(message: string, code: string = "INFRA_ERROR") {
    super(message, code);
  }
}
