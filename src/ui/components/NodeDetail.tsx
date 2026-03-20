import React from "react";
import Graph from "graphology";
import { getNodeColor } from "../lib/colors.js";

function displayType(type: string): string {
  return type.replace(/^Concept/, "");
}

interface Props {
  graph: Graph;
  nodeId: string;
  onClose: () => void;
  onExpand: (id: string, type: string) => void;
  onSelectNode: (id: string) => void;
}

export function NodeDetail({ graph, nodeId, onClose, onExpand, onSelectNode }: Props) {
  if (!graph.hasNode(nodeId)) return null;

  const attrs = graph.getNodeAttributes(nodeId);
  const nodeType = attrs.nodeType as string;
  const label = attrs.label as string;
  const color = getNodeColor(nodeType);

  // Get connected nodes
  const neighbors: { id: string; type: string; label: string; edge: string }[] = [];
  graph.forEachEdge(nodeId, (_edge, edgeAttrs, source, target, sourceAttrs, targetAttrs) => {
    const neighborId = source === nodeId ? target : source;
    const neighborAttrs = source === nodeId ? targetAttrs : sourceAttrs;
    neighbors.push({
      id: neighborId,
      type: neighborAttrs.nodeType as string,
      label: neighborAttrs.label as string,
      edge: edgeAttrs.label as string,
    });
  });

  // Filter display props
  const skipKeys = new Set(["label", "nodeType", "color", "size", "x", "y"]);
  const displayProps = Object.entries(attrs).filter(
    ([k]) => !skipKeys.has(k) && attrs[k] != null,
  );

  return (
    <div className="node-detail">
      <div className="node-detail-header">
        <span className="node-type-badge" style={{ backgroundColor: color }}>
          {displayType(nodeType)}
        </span>
        <span className="node-detail-title">{label}</span>
        <button className="node-detail-close" onClick={onClose}>
          x
        </button>
      </div>

      {displayProps.length > 0 && (
        <div className="node-detail-props">
          {displayProps.map(([key, value]) => (
            <div key={key} className="node-prop">
              <span className="node-prop-key">{key}</span>
              <span className="node-prop-value">{String(value)}</span>
            </div>
          ))}
        </div>
      )}

      <button
        className="node-expand-btn"
        onClick={() => onExpand(nodeId, nodeType)}
      >
        Expand neighborhood
      </button>

      {neighbors.length > 0 && (
        <div className="node-connections">
          <div className="node-connections-title">
            Connections ({neighbors.length})
          </div>
          {neighbors.map((n) => (
            <div
              key={n.id}
              className="node-connection"
              onClick={() => onSelectNode(n.id)}
            >
              <span
                className="legend-dot"
                style={{ backgroundColor: getNodeColor(n.type) }}
              />
              <span className="node-connection-label">{n.label}</span>
              <span className="node-connection-edge">{n.edge}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
