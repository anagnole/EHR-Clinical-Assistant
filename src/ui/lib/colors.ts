export const NODE_COLORS: Record<string, string> = {
  Patient: "#4A90D9",
  ConceptCondition: "#E74C3C",
  ConceptMedication: "#50C878",
  ConceptObservation: "#F5A623",
  Encounter: "#9B59B6",
  ConceptProcedure: "#1ABC9C",
  Provider: "#E67E22",
  Organization: "#95A5A6",
};

export function getNodeColor(type: string): string {
  return NODE_COLORS[type] ?? "#888888";
}
