import React, { useEffect, useRef } from "react";
import Sigma from "sigma";
import Graph from "graphology";
import type { DateRange } from "./GraphPanel.js";

interface Props {
  graph: Graph;
  selectedNode: string | null;
  hiddenTypes: Set<string>;
  dateRange: DateRange;
  onClickNode: (id: string) => void;
}

/** Check if an edge's date falls within the filter range */
function edgeInDateRange(graph: Graph, edge: string, dateRange: DateRange): boolean {
  if (!dateRange.from && !dateRange.to) return true;
  // Edges won't have date attributes in the graphology graph (they come from Kuzu relationship properties)
  // so we can't filter them client-side. The edge labels (DIAGNOSED_WITH etc.) don't carry date data.
  // For now, always show — the card API handles date filtering server-side.
  return true;
}

export function SigmaRenderer({ graph, selectedNode, hiddenTypes, dateRange, onClickNode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const selectedRef = useRef<string | null>(null);
  const hiddenRef = useRef<Set<string>>(hiddenTypes);
  const dateRef = useRef<DateRange>(dateRange);
  selectedRef.current = selectedNode;
  hiddenRef.current = hiddenTypes;
  dateRef.current = dateRange;

  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: true,
      labelSize: 12,
      labelRenderedSizeThreshold: 6,
      defaultEdgeType: "arrow",
      edgeLabelSize: 9,
      zIndex: true,
      nodeReducer: (node, data) => {
        const sel = selectedRef.current;
        const hidden = hiddenRef.current;
        const res = { ...data };

        if (hidden.has(data.nodeType as string)) {
          res.hidden = true;
          return res;
        }

        if (sel) {
          if (node === sel) {
            res.highlighted = true;
            res.label = data.label;
            res.zIndex = 10;
            res.forceLabel = true;
          } else if (graph.hasEdge(node, sel) || graph.hasEdge(sel, node)) {
            res.label = data.label;
            res.forceLabel = true;
            res.zIndex = 5;
          } else {
            res.color = "#2a2d3a30";
            res.label = "";
            res.zIndex = 0;
          }
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const sel = selectedRef.current;
        const hidden = hiddenRef.current;
        const dr = dateRef.current;
        const res = { ...data };

        const [source, target] = graph.extremities(edge);
        const sourceType = graph.getNodeAttribute(source, "nodeType") as string;
        const targetType = graph.getNodeAttribute(target, "nodeType") as string;

        if (hidden.has(sourceType) || hidden.has(targetType)) {
          res.hidden = true;
          return res;
        }

        // Date filter
        if ((dr.from || dr.to) && !edgeInDateRange(graph, edge, dr)) {
          res.hidden = true;
          return res;
        }

        if (sel) {
          if (source === sel || target === sel) {
            res.size = 2.5;
            res.zIndex = 5;
          } else {
            res.color = "#1a1d2715";
            res.label = "";
            res.size = 0.5;
            res.zIndex = 0;
          }
        }
        return res;
      },
    });

    renderer.on("clickNode", ({ node }) => {
      onClickNode(node);
    });

    renderer.on("clickStage", () => {
      onClickNode("");
    });

    sigmaRef.current = renderer;

    return () => {
      renderer.kill();
      sigmaRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    renderer.refresh();

    if (selectedNode && graph.hasNode(selectedNode)) {
      const displayData = renderer.getNodeDisplayData(selectedNode);
      if (displayData && displayData.x > 0.5) {
        const container = containerRef.current!;
        const dx = (displayData.x - 0.5) * container.offsetWidth;
        const camera = renderer.getCamera();
        const state = camera.getState();
        const scale = (displayData.x - 0.5) * 3;
        const graphDx = (dx / container.offsetWidth) * 0.5 * scale;
        camera.animate(
          { x: state.x + graphDx, y: state.y },
          { duration: 300 },
        );
      }
    }
  }, [selectedNode, hiddenTypes, dateRange]);

  return <div ref={containerRef} className="sigma-container" />;
}
