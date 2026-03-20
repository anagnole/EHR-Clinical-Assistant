import React from "react";
import Markdown from "react-markdown";

interface Props {
  role: "user" | "assistant";
  content: string;
}

export function ChatMessage({ role, content }: Props) {
  return (
    <div className={`chat-message ${role}`}>
      <div className="chat-message-label">
        {role === "user" ? "You" : "EHR Assistant"}
      </div>
      <div className="chat-message-bubble">
        {role === "assistant" ? (
          <Markdown>{content}</Markdown>
        ) : (
          <p>{content}</p>
        )}
      </div>
    </div>
  );
}
