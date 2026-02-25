import { AppError } from "./errors";

export function successResponse(
  requestId: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return { requestId, ...data };
}

export function errorResponse(
  requestId: string,
  err: unknown,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const message = err instanceof Error ? err.message : String(err);
  const errorCode = err instanceof AppError ? err.code : "UNKNOWN_ERROR";

  return {
    requestId,
    error: message,
    errorCode,
    ...extra,
  };
}
