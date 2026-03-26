import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChatPanel } from "./components/ChatPanel.js";
import type { ContextItem } from "./components/ChatPanel.js";
import { GraphPanel } from "./components/GraphPanel.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { TemplatesPage } from "./components/TemplatesPage.js";
import { useChat } from "./lib/useChat.js";
import { useGraph } from "./lib/useGraph.js";

function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("ehr-theme") as "light" | "dark") ?? "dark";
  });

  const { messages, status, send, setModel, currentModel, toolEvents } = useChat();
  const {
    graph,
    selectedNode,
    setSelectedNode,
    expandNode,
    addFromToolEvent,
    addSubgraph,
  } = useGraph();

  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ehr-theme", theme);
  }, [theme]);

  // Feed tool events to graph
  const processedRef = useRef(0);
  useEffect(() => {
    const newEvents = toolEvents.slice(processedRef.current);
    processedRef.current = toolEvents.length;
    for (const event of newEvents) {
      addFromToolEvent(event.tool, event.input);
    }
  }, [toolEvents, addFromToolEvent]);

  // Suggested context: shown when a node is selected but not yet added
  const [suggestedContext, setSuggestedContext] = useState<ContextItem | null>(null);

  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedNode(id);
    if (id && graph.hasNode(id)) {
      const attrs = graph.getNodeAttributes(id);
      // Show as suggestion if not already in context
      const already = contextItems.some((c) => c.id === id);
      if (!already) {
        setSuggestedContext({
          id,
          type: attrs.nodeType as string,
          label: attrs.label as string,
        });
      }
    } else {
      setSuggestedContext(null);
    }
  }, [graph, setSelectedNode, contextItems]);

  const handleAddContext = useCallback((id: string) => {
    if (graph.hasNode(id)) {
      const attrs = graph.getNodeAttributes(id);
      setContextItems((prev) => {
        if (prev.some((c) => c.id === id)) return prev;
        return [...prev, {
          id,
          type: attrs.nodeType as string,
          label: attrs.label as string,
        }];
      });
      setSuggestedContext(null);
    }
  }, [graph]);

  const handleRemoveContext = useCallback((id: string) => {
    setContextItems((prev) => prev.filter((c) => c.id !== id));
    // If removing the currently selected node, turn it back into a suggestion
    if (selectedNode === id && graph.hasNode(id)) {
      const attrs = graph.getNodeAttributes(id);
      setSuggestedContext({
        id,
        type: attrs.nodeType as string,
        label: attrs.label as string,
      });
    }
  }, [selectedNode, graph]);

  const toggleTheme = () => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  };

  return (
    <div className="app-layout">
      <div className="app-header">
        <div className="app-title">EHR Clinical Assistant</div>
        <div className="app-header-actions">
          <button
            className="header-nav-btn"
            onClick={() => setShowTemplates(!showTemplates)}
          >
            {showTemplates ? "Chat" : "Templates"}
          </button>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>
      <div className="app-body">
        {showTemplates ? (
          <TemplatesPage
            onBack={() => setShowTemplates(false)}
            onUseTemplate={(t) => {
              // Add template as context and switch to chat
              send(`Using template "${t.name}":\n\n${t.content}`);
              setShowTemplates(false);
            }}
          />
        ) : (
        <ChatPanel
          messages={messages}
          status={status}
          currentModel={currentModel}
          onSetModel={setModel}
          contextItems={contextItems}
          suggestedContext={suggestedContext}
          onSend={send}
          onRemoveContext={handleRemoveContext}
          onAddContext={handleAddContext}
        />
        )}
        {!showTemplates && (
        <GraphPanel
          graph={graph}
          selectedNode={selectedNode}
          onSelectNode={handleSelectNode}
          onExpandNode={expandNode}
          onAddSubgraph={addSubgraph}
          onAddContext={handleAddContext}
        />
        )}
      </div>
    </div>
  );
}

export default App;
