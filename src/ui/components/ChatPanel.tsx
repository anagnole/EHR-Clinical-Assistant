import React, { useRef, useEffect, useState } from "react";
import { ChatMessage } from "./ChatMessage.js";
import type { ChatMessage as ChatMessageType } from "../lib/useChat.js";

interface Props {
  messages: ChatMessageType[];
  status: string;
  onSend: (content: string) => void;
}

export function ChatPanel({ messages, status, onSend }: Props) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === "thinking") return;
    onSend(input.trim());
    setInput("");
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h2>Chat</h2>
        <div className={`status-indicator ${status}`}>
          {status === "thinking" ? "Thinking..." : ""}
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
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={status === "thinking" || status === "connecting"}
        />
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
