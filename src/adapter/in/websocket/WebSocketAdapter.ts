import { WebSocketServer, WebSocket } from "ws";
import {
  HandleDepositUseCase,
  DepositEvent,
} from "../../../domain/port/in/HandleDepositUseCase";

export class WebSocketAdapter {
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly port: number,
    private readonly handleDepositUseCase: HandleDepositUseCase,
  ) {}

  start(): void {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on("connection", (ws: WebSocket) => {
      console.log("[WS] Listener connected");

      ws.on("message", async (raw: Buffer) => {
        try {
          const event: DepositEvent = JSON.parse(raw.toString());
          await this.handleDepositUseCase.handleDeposit(event);
        } catch (err) {
          console.error("[WS] Invalid message:", err);
        }
      });

      ws.on("close", () => {
        console.log("[WS] Listener disconnected");
      });
    });

    console.log(`[WS] Server listening on port ${this.port}`);
  }

  stop(): void {
    this.wss?.close();
  }
}
