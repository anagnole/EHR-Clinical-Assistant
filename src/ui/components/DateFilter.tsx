import React from "react";

interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  onClear: () => void;
}

export function DateFilter({ from, to, onChange, onClear }: Props) {
  return (
    <div className="date-filter">
      <input
        type="date"
        value={from}
        onChange={(e) => { console.log("[date] from:", e.target.value); onChange(e.target.value, to); }}
        title="From date"
      />
      <span className="date-filter-sep">-</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        title="To date"
      />
      {(from || to) && (
        <button className="date-filter-clear" onClick={onClear} title="Clear filter">
          x
        </button>
      )}
    </div>
  );
}
