import { createLogger } from "./logger";

const logger = createLogger("Retry");

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delay?: number; label?: string } = {},
): Promise<T> {
  const { retries = 3, delay = 1000, label = "unknown" } = opts;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const waitMs = delay * attempt;
        logger.warn(
          `[${label}] Attempt ${attempt}/${retries} failed, retrying in ${waitMs}ms...`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
  }
  throw lastError;
}
