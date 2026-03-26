import { useState, useEffect, useRef, useCallback } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

type Status = "connecting" | "ready" | "thinking" | "error" | "disconnected";

interface ToolEvent {
  tool: string;
  input: Record<string, unknown>;
}

interface UseChatReturn {
  messages: ChatMessage[];
  status: Status;
  send: (content: string) => void;
  setModel: (model: string) => void;
  currentModel: string;
  toolEvents: ToolEvent[];
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>("connecting");
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [currentModel, setCurrentModel] = useState("claude-sonnet-4-6");
  const wsRef = useRef<WebSocket | null>(null);
  const msgIdRef = useRef(0);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/chat`);
    wsRef.current = ws;

    ws.onopen = () => setStatus("ready");

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "text_delta":
          if (msg.text.includes("|")) console.log("DELTA:", JSON.stringify(msg.text));
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + msg.text },
              ];
            }
            return [
              ...prev,
              {
                id: `msg-${++msgIdRef.current}`,
                role: "assistant",
                content: msg.text,
              },
            ];
          });
          break;

        case "status":
          setStatus(msg.status);
          break;

        case "error":
          console.error("[chat]", msg.message);
          break;

        case "tool_use":
          setToolEvents((prev) => [
            ...prev,
            { tool: msg.tool, input: msg.input },
          ]);
          break;

        case "model_changed":
          setCurrentModel(msg.model);
          break;
      }
    };

    ws.onclose = () => setStatus("disconnected");
    ws.onerror = () => setStatus("error");

    return () => {
      ws.close();
    };
  }, []);

  const send = useCallback((content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `msg-${++msgIdRef.current}`,
        role: "user",
        content,
      },
    ]);

    setToolEvents([]);
    ws.send(JSON.stringify({ type: "user_message", content }));
  }, []);

  const setModel = useCallback((model: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "set_model", model }));
  }, []);

  return { messages, status, send, setModel, currentModel, toolEvents };
}
