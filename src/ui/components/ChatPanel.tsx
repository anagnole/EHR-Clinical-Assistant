import React, { useRef, useEffect, useState } from "react";
import { ChatMessage } from "./ChatMessage.js";
import { getNodeColor } from "../lib/colors.js";
import type { ChatMessage as ChatMessageType } from "../lib/useChat.js";
import { fetchModels, type ModelInfo } from "../lib/api.js";

export interface ContextItem {
  id: string;
  type: string;
  label: string;
}

interface Props {
  messages: ChatMessageType[];
  status: string;
  currentModel: string;
  onSetModel: (model: string) => void;
  contextItems: ContextItem[];
  suggestedContext: ContextItem | null;
  onSend: (content: string) => void;
  onRemoveContext: (id: string) => void;
  onAddContext: (id: string) => void;
}

export function ChatPanel({ messages, status, currentModel, onSetModel, contextItems, suggestedContext, onSend, onRemoveContext, onAddContext }: Props) {
  const [input, setInput] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels().then(setModels).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === "thinking") return;

    let message = input.trim();
    if (contextItems.length > 0) {
      const contextStr = contextItems
        .map((c) => `[${c.type.replace(/^Concept/, "")}: ${c.label} (id: ${c.id})]`)
        .join(" ");
      message = `Context: ${contextStr}\n\n${message}`;
    }

    onSend(message);
    setInput("");
  };

  // All chips to show: added items + suggested (if not already added)
  const suggestedIsAdded = suggestedContext && contextItems.some((c) => c.id === suggestedContext.id);
  const hasChips = contextItems.length > 0 || (suggestedContext && !suggestedIsAdded);

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>Chat</h2>
        <div className="chat-header-controls">
          {models.length > 0 && (
            <select
              className="model-selector"
              value={currentModel}
              onChange={(e) => onSetModel(e.target.value)}
              disabled={status === "thinking"}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          )}
          <div className={`status-indicator ${status}`}>
            {status === "thinking" ? "Thinking..." : ""}
          </div>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask a question about the patient database.
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} role={msg.role} content={msg.content} />
        ))}
        {status === "thinking" && messages[messages.length - 1]?.role === "user" && (
          <div className="chat-thinking">Retrieving data...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input" onSubmit={handleSubmit}>
        <div className="chat-input-area">
          {hasChips && (
            <div className="context-chips">
              {/* Added context items — show × to remove */}
              {contextItems.map((item) => (
                <span key={item.id} className="context-chip context-chip-added">
                  <span
                    className="context-chip-dot"
                    style={{ backgroundColor: getNodeColor(item.type) }}
                  />
                  <span className="context-chip-label">
                    {item.label.length > 40 ? item.label.slice(0, 37) + "..." : item.label}
                  </span>
                  <button
                    type="button"
                    className="context-chip-btn"
                    onClick={() => onRemoveContext(item.id)}
                  >
                    &times;
                  </button>
                </span>
              ))}

              {/* Suggested context — show + to add */}
              {suggestedContext && !suggestedIsAdded && (
                <span className="context-chip context-chip-suggested">
                  <span
                    className="context-chip-dot"
                    style={{ backgroundColor: getNodeColor(suggestedContext.type) }}
                  />
                  <span className="context-chip-label">
                    {suggestedContext.label.length > 40
                      ? suggestedContext.label.slice(0, 37) + "..."
                      : suggestedContext.label}
                  </span>
                  <button
                    type="button"
                    className="context-chip-btn"
                    onClick={() => onAddContext(suggestedContext.id)}
                  >
                    +
                  </button>
                </span>
              )}
            </div>
          )}
          <input
            type="text"
            placeholder={contextItems.length > 0 ? "Ask about the selected context..." : "Type a message..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={status === "thinking" || status === "connecting"}
          />
        </div>
        <button
          type="submit"
          disabled={
            !input.trim() || status === "thinking" || status === "connecting"
          }
        >
          Send
        </button>
      </form>
    </div>
  );
}
