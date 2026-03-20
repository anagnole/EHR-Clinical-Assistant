import React, { useState, useEffect } from "react";
import { ChatPanel } from "./components/ChatPanel.js";
import { GraphPanel } from "./components/GraphPanel.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { useChat } from "./lib/useChat.js";
import { useGraph } from "./lib/useGraph.js";

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("ehr-theme") as "light" | "dark") ?? "dark";
  });

  const { messages, status, send, toolEvents } = useChat();
  const {
    graph,
    selectedNode,
    setSelectedNode,
    expandNode,
    addFromToolEvent,
    addSubgraph,
  } = useGraph();

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ehr-theme", theme);
  }, [theme]);

  // Feed tool events to graph
  useEffect(() => {
    for (const event of toolEvents) {
      addFromToolEvent(event.tool, event.input);
    }
  }, [toolEvents, addFromToolEvent]);

  const toggleTheme = () => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  };

  return (
    <div className="app-layout">
      <div className="app-header">
        <div className="app-title">EHR Clinical Assistant</div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <div className="app-body">
        <ChatPanel messages={messages} status={status} onSend={send} />
        <GraphPanel
          graph={graph}
          selectedNode={selectedNode}
          onSelectNode={setSelectedNode}
          onExpandNode={expandNode}
          onAddSubgraph={addSubgraph}
        />
      </div>
    </div>
  );
}

export default App;
