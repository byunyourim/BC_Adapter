import { Consumer, EachMessagePayload } from "kafkajs";
import { AppError } from "../../../shared/errors";

type MessageHandler = (payload: Record<string, unknown>) => Promise<void>;

export class KafkaConsumerAdapter {
  private readonly topicHandlers = new Map<string, MessageHandler>();

  constructor(private readonly consumer: Consumer) {}

  register(topic: string, handler: MessageHandler): void {
    this.topicHandlers.set(topic, handler);
  }

  async start(): Promise<void> {
    await this.consumer.connect();

    const topics = [...this.topicHandlers.keys()];
    await this.consumer.subscribe({ topics, fromBeginning: false });

    await this.consumer.run({
      eachMessage: async ({ topic, message }: EachMessagePayload) => {
        const handler = this.topicHandlers.get(topic);
        if (!handler) return;

        try {
          const value = message.value?.toString();
          if (!value) return;
          const data = JSON.parse(value);
          console.log(`[Kafka] Received on ${topic}:`, data);
          await handler(data);
        } catch (err) {
          if (err instanceof AppError) {
            console.error(`[Kafka] ${err.name} [${err.code}] on ${topic}: ${err.message}`);
          } else {
            console.error(`[Kafka] Unexpected error processing ${topic}:`, err);
          }
        }
      },
    });

    console.log(`[Kafka] Consumer subscribed to: ${topics.join(", ")}`);
  }

  async stop(): Promise<void> {
    await this.consumer.disconnect();
  }
}
