import type { ParsedDataset } from "../parser/types.js";
import type { DataProfile, GroundTruthQuestion } from "./types.js";

let counter = 0;
function id() {
  return `TMP-${++counter}`;
}

export function generateTemporal(
  ds: ParsedDataset,
  profile: DataProfile
): GroundTruthQuestion[] {
  counter = 0;
  const questions: GroundTruthQuestion[] = [];
  // Reverse sort to draw from different patients than simple-lookup and multi-hop
  const sortedPatients = [...ds.patients].sort((a, b) => b.id.localeCompare(a.id));

  // 1. Lab value trend over time (~12)
  const trendLabs = [
    { code: "4548-4", name: "Hemoglobin A1c", domain: "diabetes" },
    { code: "2160-0", name: "Creatinine", domain: "renal" },
    { code: "8480-6", name: "Systolic Blood Pressure", domain: "cardiovascular" },
    { code: "2093-3", name: "Total Cholesterol", domain: "cardiovascular" },
    { code: "33914-3", name: "eGFR", domain: "renal" },
    { code: "2571-8", name: "Triglycerides", domain: "cardiovascular" },
    { code: "2085-9", name: "HDL Cholesterol", domain: "cardiovascular" },
    { code: "39156-5", name: "Body Mass Index", domain: "general" },
  ];

  let q1Count = 0;
  for (const lab of trendLabs) {
    if (q1Count >= 12) break;
    let perLabCount = 0;
    for (const patient of sortedPatients) {
      if (perLabCount >= 2 || q1Count >= 12) break;
      const obs = ds.byPatient.observations.get(patient.id);
      if (!obs) continue;
      const matching = obs
        .filter((o) => o.code === lab.code && o.type === "numeric")
        .sort((a, b) => a.date.localeCompare(b.date));
      if (matching.length < 3) continue;

      // Take last 5 values (or all if fewer)
      const recent = matching.slice(-5);
      const trendData = recent.map((o) => `${o.date.slice(0, 10)}: ${o.value} ${o.units}`);
      const firstVal = parseFloat(recent[0].value);
      const lastVal = parseFloat(recent[recent.length - 1].value);
      const trend = lastVal > firstVal * 1.05 ? "increasing" : lastVal < firstVal * 0.95 ? "decreasing" : "stable";

      questions.push({
        id: id(),
        type: "temporal",
        question: `What is the trend in ${lab.name} values for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id}) over their recent measurements?`,
        answer: `${trend} trend. Values: ${trendData.join(", ")}`,
        patientIds: [patient.id],
        domain: lab.domain,
        supportingRecordIds: recent.map((o) => o.id),
      });
      q1Count++;
      perLabCount++;
    }
  }

  // 2. First diagnosis date for a condition (~12)
  const condTargets = [
    "Diabetes",
    "Hypertension",
    "Prediabetes",
    "Hyperlipidemia",
    "Osteoarthritis",
    "Chronic kidney disease",
    "Asthma",
    "Atrial Fibrillation",
  ];

  let q2Count = 0;
  for (const condName of condTargets) {
    if (q2Count >= 12) break;
    let perCondCount = 0;
    for (const patient of sortedPatients) {
      if (perCondCount >= 2 || q2Count >= 12) break;
      const conds = ds.byPatient.conditions.get(patient.id);
      if (!conds) continue;
      const matching = conds
        .filter((c) => c.description.toLowerCase().includes(condName.toLowerCase()))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      if (matching.length === 0) continue;

      questions.push({
        id: id(),
        type: "temporal",
        question: `When was patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id}) first diagnosed with ${matching[0].description}?`,
        answer: matching[0].startDate.slice(0, 10),
        patientIds: [patient.id],
        domain: "conditions",
        supportingRecordIds: [matching[0].id],
      });
      q2Count++;
      perCondCount++;
    }
  }

  // 3. Medication duration (~12)
  let q3Count = 0;
  for (const patient of sortedPatients) {
    if (q3Count >= 12) break;
    const meds = ds.byPatient.medications.get(patient.id);
    if (!meds) continue;
    const stopped = meds.filter((m) => m.stopDate).sort((a, b) => a.description.localeCompare(b.description));
    if (stopped.length === 0) continue;

    const med = stopped[0];
    const start = new Date(med.startDate);
    const stop = new Date(med.stopDate!);
    const days = Math.round((stop.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    questions.push({
      id: id(),
      type: "temporal",
      question: `How long was patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id}) on ${med.description}?`,
      answer: `${days} days (from ${med.startDate.slice(0, 10)} to ${med.stopDate!.slice(0, 10)})`,
      patientIds: [patient.id],
      domain: "medications",
      supportingRecordIds: [med.id],
    });
    q3Count++;
  }

  // 4. Medications started within 6 months of a diagnosis (~12)
  let q4Count = 0;
  for (const patient of sortedPatients) {
    if (q4Count >= 12) break;
    const conds = ds.byPatient.conditions.get(patient.id);
    const meds = ds.byPatient.medications.get(patient.id);
    if (!conds || !meds) continue;

    for (const cond of conds) {
      if (q4Count >= 12) break;
      const diagDate = new Date(cond.startDate);
      const sixMonthsLater = new Date(diagDate);
      sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);

      const medsInWindow = meds.filter((m) => {
        const mDate = new Date(m.startDate);
        return mDate >= diagDate && mDate <= sixMonthsLater;
      });

      if (medsInWindow.length < 2) continue;

      const medNames = [...new Set(medsInWindow.map((m) => m.description))].sort();
      questions.push({
        id: id(),
        type: "temporal",
        question: `What medications were started within 6 months of ${patient.firstName} ${patient.lastName} (ID: ${patient.id}) being diagnosed with ${cond.description}?`,
        answer: medNames.join("; "),
        patientIds: [patient.id],
        domain: "medications",
        supportingRecordIds: [cond.id, ...medsInWindow.map((m) => m.id)],
      });
      q4Count++;
      break;
    }
  }

  // 5. Chronological condition ordering (~12)
  let q5Count = 0;
  for (const patient of sortedPatients) {
    if (q5Count >= 12) break;
    const conds = ds.byPatient.conditions.get(patient.id);
    if (!conds) continue;
    const uniqueConds = new Map<string, typeof conds[0]>();
    for (const c of conds) {
      if (!uniqueConds.has(c.description)) uniqueConds.set(c.description, c);
    }
    if (uniqueConds.size < 3) continue;

    const sorted = [...uniqueConds.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const first5 = sorted.slice(0, 5);
    const timeline = first5.map((c) => `${c.startDate.slice(0, 10)}: ${c.description}`);

    questions.push({
      id: id(),
      type: "temporal",
      question: `In what chronological order were conditions diagnosed for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id})?`,
      answer: timeline.join("; "),
      patientIds: [patient.id],
      domain: "conditions",
      supportingRecordIds: first5.map((c) => c.id),
    });
    q5Count++;
  }

  return questions;
}
