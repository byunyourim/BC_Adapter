export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, err?: unknown): void;
}

export function createLogger(label: string): Logger {
  return {
    info: (msg: string, data?: unknown) =>
      console.log(`[${label}] ${msg}`, data ?? ""),
    warn: (msg: string, data?: unknown) =>
      console.warn(`[${label}] ${msg}`, data ?? ""),
    error: (msg: string, err?: unknown) =>
      console.error(`[${label}] ${msg}`, err ?? ""),
  };
}
