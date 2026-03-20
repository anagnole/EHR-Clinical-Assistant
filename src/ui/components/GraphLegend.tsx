import React from "react";
import { NODE_COLORS } from "../lib/colors.js";

interface Props {
  hiddenTypes: Set<string>;
  onToggle: (type: string) => void;
}

export function GraphLegend({ hiddenTypes, onToggle }: Props) {
  return (
    <div className="graph-legend">
      {Object.entries(NODE_COLORS).map(([type, color]) => {
        const hidden = hiddenTypes.has(type);
        return (
          <div
            key={type}
            className={`legend-item legend-filter ${hidden ? "legend-hidden" : ""}`}
            onClick={() => onToggle(type)}
            title={hidden ? `Show ${type.replace(/^Concept/, "")}` : `Hide ${type.replace(/^Concept/, "")}`}
          >
            <span
              className="legend-dot"
              style={{ backgroundColor: hidden ? "transparent" : color, borderColor: color }}
            />
            <span className="legend-label">{type.replace(/^Concept/, "")}</span>
          </div>
        );
      })}
    </div>
  );
}
