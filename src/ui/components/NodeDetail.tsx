import React, { useEffect, useState } from "react";
import Graph from "graphology";
import { getNodeColor } from "../lib/colors.js";
import { fetchNodeCard } from "../lib/api.js";
import type { DateRange } from "./GraphPanel.js";

function displayType(type: string): string {
  return type.replace(/^Concept/, "");
}

interface Props {
  graph: Graph;
  nodeId: string;
  dateRange: DateRange;
  onClose: () => void;
  onExpand: (id: string, type: string) => void;
  onSelectNode: (id: string) => void;
  onAddContext: (id: string) => void;
}

export function NodeDetail({ graph, nodeId, dateRange, onClose, onExpand, onSelectNode, onAddContext }: Props) {
  const [card, setCard] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const hasNode = graph.hasNode(nodeId);
  const attrs = hasNode ? graph.getNodeAttributes(nodeId) : null;
  const nodeType = (attrs?.nodeType as string) ?? "";
  const color = getNodeColor(nodeType);

  useEffect(() => {
    if (!hasNode) return;
    console.log("[card] fetching:", nodeId, nodeType, dateRange.from, dateRange.to);
    setLoading(true);
    setCard(null);
    fetchNodeCard(nodeId, nodeType, dateRange.from || undefined, dateRange.to || undefined)
      .then(setCard)
      .catch(() => setCard(null))
      .finally(() => setLoading(false));
  }, [nodeId, nodeType, hasNode, dateRange.from, dateRange.to]);

  if (!hasNode) return null;

  // Connected nodes for the connections list
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

  return (
    <div className="node-detail">
      <div className="node-detail-header">
        <span className="node-type-badge" style={{ backgroundColor: color }}>
          {displayType(card?.type as string ?? nodeType)}
        </span>
        <span className="node-detail-title">
          {(card?.name ?? card?.description ?? attrs.label) as string}
        </span>
        <button className="node-detail-close" onClick={onClose}>x</button>
      </div>

      <div className="node-card-body">
        {loading && <div className="node-card-loading">Loading...</div>}

        {card && !loading && renderCard(card)}
      </div>

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
          {neighbors.slice(0, 15).map((n) => (
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
          {neighbors.length > 15 && (
            <div className="node-connection-more">+{neighbors.length - 15} more</div>
          )}
        </div>
      )}
    </div>
  );
}

function renderCard(card: Record<string, unknown>) {
  switch (card.type) {
    case "Patient":
      return <PatientCard card={card} />;
    case "Condition":
      return <ConditionCard card={card} />;
    case "Medication":
      return <MedicationCard card={card} />;
    case "Observation":
      return <ObservationCard card={card} />;
    case "Procedure":
      return <ProcedureCard card={card} />;
    case "Encounter":
      return <EncounterCard card={card} />;
    case "Provider":
      return <ProviderCard card={card} />;
    case "Organization":
      return <OrganizationCard card={card} />;
    default:
      return null;
  }
}

function CardRow({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="card-row">
      <span className="card-row-label">{label}</span>
      <span className="card-row-value">{String(value)}</span>
    </div>
  );
}

function CardList({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="card-list">
      <div className="card-list-label">{label}</div>
      {items.map((item, i) => (
        <div key={i} className="card-list-item">{item}</div>
      ))}
    </div>
  );
}

function PatientCard({ card }: { card: Record<string, unknown> }) {
  return (
    <>
      <CardRow label="Age" value={card.age} />
      <CardRow label="Gender" value={card.gender} />
      <CardRow label="Race" value={card.race} />
      <CardRow label="Location" value={card.location} />
      <CardRow label="Status" value={(card.alive as boolean) ? "Alive" : "Deceased"} />
      <div className="card-stats">
        <div className="card-stat">
          <span className="card-stat-value">{String(card.conditionCount)}</span>
          <span className="card-stat-label">Conditions</span>
        </div>
        <div className="card-stat">
          <span className="card-stat-value">{String(card.medicationCount)}</span>
          <span className="card-stat-label">Medications</span>
        </div>
        <div className="card-stat">
          <span className="card-stat-value">{String(card.encounterCount)}</span>
          <span className="card-stat-label">Encounters</span>
        </div>
      </div>
      <CardList label="Active Conditions" items={card.activeConditions as string[]} />
      <CardList label="Active Medications" items={card.activeMedications as string[]} />
    </>
  );
}

function ConditionCard({ card }: { card: Record<string, unknown> }) {
  return (
    <>
      <CardRow label="SNOMED" value={card.code} />
      <CardRow label="Patients" value={card.patientCount} />
      <CardList label="Treatments" items={card.treatments as string[]} />
      <CardList label="Complications" items={card.complications as string[]} />
    </>
  );
}

function MedicationCard({ card }: { card: Record<string, unknown> }) {
  return (
    <>
      <CardRow label="RxNorm" value={card.code} />
      <CardRow label="Patients" value={card.patientCount} />
      <CardList label="Treats" items={card.treatsConditions as string[]} />
    </>
  );
}

function ObservationCard({ card }: { card: Record<string, unknown> }) {
  return (
    <>
      <CardRow label="LOINC" value={card.code} />
      <CardRow label="Category" value={card.category} />
      <CardRow label="Units" value={card.units} />
      <CardRow label="Type" value={card.valueType} />
      <CardRow label="Patients" value={card.patientCount} />
    </>
  );
}

function ProcedureCard({ card }: { card: Record<string, unknown> }) {
  return (
    <>
      <CardRow label="Code" value={card.code} />
      <CardRow label="Patients" value={card.patientCount} />
      <CardList label="Indicated By" items={card.indications as string[]} />
    </>
  );
}

function EncounterCard({ card }: { card: Record<string, unknown> }) {
  return (
    <>
      <CardRow label="Class" value={card.encounterClass} />
      <CardRow label="Date" value={card.startDate} />
      <CardRow label="Reason" value={card.reason} />
      <CardRow label="Patient" value={card.patient} />
      <CardRow label="Provider" value={card.provider} />
      <CardRow label="Organization" value={card.organization} />
    </>
  );
}

function ProviderCard({ card }: { card: Record<string, unknown> }) {
  return (
    <>
      <CardRow label="Specialty" value={card.specialty} />
      <CardRow label="Gender" value={card.gender} />
      <CardRow label="Organization" value={card.organization} />
      <CardRow label="Patients Seen" value={card.patientCount} />
    </>
  );
}

function OrganizationCard({ card }: { card: Record<string, unknown> }) {
  return (
    <>
      <CardRow label="Location" value={card.location} />
      <CardRow label="Phone" value={card.phone} />
      <CardRow label="Providers" value={card.providerCount} />
    </>
  );
}
