import React, { useState, useRef, useEffect } from "react";
import { searchGraphNodes } from "../lib/api.js";
import { getNodeColor } from "../lib/colors.js";
import type { SearchResult } from "../../api/types.js";

interface Props {
  onSelect: (result: SearchResult) => void;
}

export function GraphSearch({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        console.log("[graph-search] querying:", query);
        const r = await searchGraphNodes(query);
        console.log("[graph-search] results:", r);
        setResults(r);
        setOpen(r.length > 0);
      } catch (err) {
        console.error("[graph-search] error:", err);
        setResults([]);
      }
    }, 300);

    return () => clearTimeout(timerRef.current);
  }, [query]);

  return (
    <div className="graph-search">
      <input
        type="text"
        placeholder="Search graph..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && (
        <div className="graph-search-results">
          {results.map((r) => (
            <div
              key={r.id}
              className="graph-search-item"
              onMouseDown={() => {
                onSelect(r);
                setQuery("");
                setOpen(false);
              }}
            >
              <span
                className="legend-dot"
                style={{ backgroundColor: getNodeColor(r.type) }}
              />
              <span className="search-item-label">{r.label}</span>
              <span className="search-item-type">{r.type.replace(/^Concept/, "")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
