import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import noverlap from "graphology-layout-noverlap";
import { getNodeColor } from "./colors.js";
import type { Subgraph } from "../../api/types.js";

export function mergeSubgraph(graph: Graph, subgraph: Subgraph): void {
  for (const node of subgraph.nodes) {
    if (!graph.hasNode(node.id)) {
      graph.addNode(node.id, {
        label: node.label,
        nodeType: node.type,
        color: getNodeColor(node.type),
        size: 5,
        x: Math.random() * 100,
        y: Math.random() * 100,
        ...node.props,
      });
    }
  }

  for (const edge of subgraph.edges) {
    const key = `${edge.source}-${edge.type}-${edge.target}`;
    if (
      graph.hasNode(edge.source) &&
      graph.hasNode(edge.target) &&
      !graph.hasEdge(key)
    ) {
      graph.addEdgeWithKey(key, edge.source, edge.target, {
        label: edge.type,
        type: "arrow",
        size: 1,
      });
    }
  }
}

export function updateNodeSizes(graph: Graph): void {
  graph.forEachNode((node) => {
    const degree = graph.degree(node);
    graph.setNodeAttribute(node, "size", 5 + Math.min(degree * 2, 30));
  });
}

export function runLayout(graph: Graph): void {
  if (graph.order < 2) return;

  forceAtlas2.assign(graph, {
    iterations: 100,
    settings: {
      gravity: 1,
      scalingRatio: 2,
      barnesHutOptimize: graph.order > 100,
    },
  });

  noverlap.assign(graph, 50);
}
