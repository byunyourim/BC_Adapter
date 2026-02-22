import { Kafka } from "kafkajs";
import { config } from "./index";

export const kafka = new Kafka({
  clientId: config.kafka.clientId,
  brokers: config.kafka.brokers,
});
