import type { FastifyPluginAsync } from "fastify";
import { getClaudeProcess } from "../claude-process.js";
import type { WsClientMessage, WsServerMessage } from "../types.js";

export const chatRoute: FastifyPluginAsync = async (app) => {
  app.get("/chat", { websocket: true }, (socket) => {
    const claude = getClaudeProcess();
    let responseBuffer = "";

    const send = (msg: WsServerMessage) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    };

    send({ type: "status", status: claude.isReady ? "ready" : "thinking" });

    const unsubText = claude.onText((text) => {
      responseBuffer += text;
      send({ type: "text_delta", text });
    });

    const unsubStatus = claude.onStatus((status) => {
      if (status === "error") {
        responseBuffer = "";
        send({ type: "error", message: "An error occurred. Please try again." });
        send({ type: "status", status: "ready" });
        return;
      }
      if (status === "ready") {
        responseBuffer = "";
      }
      send({ type: "status", status });
    });

    const unsubToolUse = claude.onToolUse((tool, input) => {
      console.log("[chat] tool_use:", tool, JSON.stringify(input).slice(0, 200));
      send({ type: "tool_use", tool, input });
    });

    const unsubModel = claude.onModelChange((model) => {
      send({ type: "model_changed", model });
    });

    // Send current model on connect
    send({ type: "model_changed", model: claude.model });

    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsClientMessage;
        if (msg.type === "user_message" && msg.content.trim()) {
          try {
            responseBuffer = "";
            claude.send(msg.content.trim());
          } catch {
            send({ type: "error", message: "Assistant is still thinking..." });
          }
        } else if (msg.type === "set_model") {
          try {
            claude.setModel(msg.model);
          } catch (err) {
            send({ type: "error", message: (err as Error).message });
          }
        }
      } catch {
        send({ type: "error", message: "Invalid message format" });
      }
    });

    socket.on("close", () => {
      unsubText();
      unsubStatus();
      unsubToolUse();
      unsubModel();
    });
  });
};
