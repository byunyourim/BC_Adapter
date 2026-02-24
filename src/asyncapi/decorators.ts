export interface AsyncApiOptions {
  title: string;
  version: string;
  description: string;
  server: { name: string; url: string; protocol: string };
}

export interface SubscribeOptions {
  channel: string;
  operationId: string;
  summary: string;
  description: string;
}

export interface PublishOptions {
  channel: string;
  operationId: string;
  summary: string;
  description: string;
}

/** Class decorator – marks the class as an AsyncAPI spec root. Runtime no-op. */
export function AsyncApi(_opts: AsyncApiOptions): ClassDecorator {
  return () => {};
}

/** Method decorator – external → adapter (the app *subscribes* / consumes). Runtime no-op. */
export function Subscribe(_opts: SubscribeOptions): MethodDecorator {
  return () => {};
}

/** Method decorator – adapter → external (the app *publishes* / produces). Runtime no-op. */
export function Publish(_opts: PublishOptions): MethodDecorator {
  return () => {};
}
