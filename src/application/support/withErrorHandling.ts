import { MessagePublisher } from "../../domain/port/out/MessagePublisher";
import { errorResponse } from "../../shared/response";

interface WithErrorHandlingOptions<TReq> {
  topic: string;
  label: string;
  getRequestId: (req: TReq) => string;
  getErrorContext?: (req: TReq) => Record<string, unknown>;
}

export function withErrorHandling<TReq>(
  publisher: MessagePublisher,
  options: WithErrorHandlingOptions<TReq>,
  fn: (req: TReq) => Promise<void>,
): (req: TReq) => Promise<void> {
  const { topic, label, getRequestId, getErrorContext } = options;

  return async (req: TReq): Promise<void> => {
    try {
      await fn(req);
    } catch (err) {
      const requestId = getRequestId(req);
      console.error(`[${label}] Failed:`, err);

      const extra = getErrorContext?.(req);
      await publisher.publish(topic, errorResponse(requestId, err, extra));
    }
  };
}
