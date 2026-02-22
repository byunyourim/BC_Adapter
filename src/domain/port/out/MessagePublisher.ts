export interface MessagePublisher {
  publish(topic: string, payload: Record<string, unknown>): Promise<void>;
}
