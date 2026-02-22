import { Producer } from "kafkajs";
import { MessagePublisher } from "../../../domain/port/out/MessagePublisher";

export class KafkaProducerAdapter implements MessagePublisher {
  constructor(private readonly producer: Producer) {}

  async publish(topic: string, payload: Record<string, unknown>): Promise<void> {
    await this.producer.send({
      topic,
      messages: [{ value: JSON.stringify(payload) }],
    });
    console.log(`[Kafka] Sent to ${topic}:`, payload);
  }
}
