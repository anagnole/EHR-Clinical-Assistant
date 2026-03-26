import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  role: "user" | "assistant";
  content: string;
}

const DOC_PATTERN = /\[DOCUMENT:([^\]]+)\]/g;

function DocumentButton({ filename }: { filename: string }) {
  const displayName = filename.replace(/\.(md|txt|html|docx)$/, "").replace(/-/g, " ");

  const handleDownload = () => {
    // Request the .docx version
    const a = document.createElement("a");
    a.href = `/api/documents/${filename}`;
    a.download = filename.replace(/\.(md|txt)$/, ".docx");
    a.click();
  };

  return (
    <button className="doc-download-btn" onClick={handleDownload}>
      <span className="doc-download-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1v9m0 0L5 7m3 3l3-3M2 12v1.5A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
      <span className="doc-download-label">{displayName}</span>
      <span className="doc-download-format">.docx</span>
    </button>
  );
}

export function ChatMessage({ role, content }: Props) {
  if (role === "user") {
    return (
      <div className="chat-message user">
        <div className="chat-message-label">You</div>
        <div className="chat-message-bubble">
          <p>{content}</p>
        </div>
      </div>
    );
  }

  // Split content by document markers
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(DOC_PATTERN);

  while ((match = regex.exec(content)) !== null) {
    // Text before the marker
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      parts.push(
        <Markdown key={`md-${lastIndex}`} remarkPlugins={[remarkGfm]}>
          {text}
        </Markdown>
      );
    }
    // The document button
    parts.push(<DocumentButton key={`doc-${match.index}`} filename={match[1]} />);
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last marker
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex);
    parts.push(
      <Markdown key={`md-${lastIndex}`} remarkPlugins={[remarkGfm]}>
        {text}
      </Markdown>
    );
  }

  return (
    <div className="chat-message assistant">
      <div className="chat-message-label">EHR Assistant</div>
      <div className="chat-message-bubble">
        {parts.length > 0 ? parts : (
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        )}
      </div>
    </div>
  );
}
