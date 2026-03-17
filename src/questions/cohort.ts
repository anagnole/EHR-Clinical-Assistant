import type { ParsedDataset } from "../parser/types.js";
import type { DataProfile, GroundTruthQuestion } from "./types.js";

let counter = 0;
function id() {
  return `COH-${++counter}`;
}

export function generateCohort(
  ds: ParsedDataset,
  profile: DataProfile
): GroundTruthQuestion[] {
  counter = 0;
  const questions: GroundTruthQuestion[] = [];

  // Build per-patient condition sets and observation maps for reuse
  const patientConditionSets = new Map<string, Set<string>>();
  for (const c of ds.conditions) {
    let set = patientConditionSets.get(c.patientId);
    if (!set) {
      set = new Set();
      patientConditionSets.set(c.patientId, set);
    }
    set.add(c.description);
  }

  const patientMedSets = new Map<string, Set<string>>();
  for (const m of ds.medications) {
    let set = patientMedSets.get(m.patientId);
    if (!set) {
      set = new Set();
      patientMedSets.set(m.patientId, set);
    }
    set.add(m.description);
  }

  // 1. Condition co-occurrence counts (~6)
  const coOccurrencePairs = [
    ["Diabetes", "Hypertension"],
    ["Diabetes", "Hyperlipidemia"],
    ["Hypertension", "Hyperlipidemia"],
    ["Diabetes", "Chronic kidney disease"],
    ["Hypertension", "Chronic kidney disease"],
    ["Prediabetes", "Hypertension"],
    ["Diabetes", "Obesity"],
    ["Hypertension", "Obesity"],
    ["Asthma", "Obesity"],
  ];

  for (const [condA, condB] of coOccurrencePairs) {
    let count = 0;
    const matchingPatientIds: string[] = [];
    for (const [patientId, condSet] of patientConditionSets) {
      const hasA = [...condSet].some((c) => c.toLowerCase().includes(condA.toLowerCase()));
      const hasB = [...condSet].some((c) => c.toLowerCase().includes(condB.toLowerCase()));
      if (hasA && hasB) {
        count++;
        if (matchingPatientIds.length < 5) matchingPatientIds.push(patientId);
      }
    }
    if (count === 0) continue;

    questions.push({
      id: id(),
      type: "cohort",
      question: `How many patients have both ${condA} and ${condB}?`,
      answer: `${count} patients`,
      patientIds: [],
      domain: "conditions",
      supportingRecordIds: [],
    });
  }

  // 2. Average lab value for patients with a condition (~6)
  const labCondPairs = [
    { cond: "Diabetes", labCode: "4548-4", labName: "Hemoglobin A1c", domain: "diabetes" },
    { cond: "Chronic kidney disease", labCode: "2160-0", labName: "Creatinine", domain: "renal" },
    { cond: "Hyperlipidemia", labCode: "2093-3", labName: "Total Cholesterol", domain: "cardiovascular" },
    { cond: "Hypertension", labCode: "8480-6", labName: "Systolic Blood Pressure", domain: "cardiovascular" },
    { cond: "Chronic kidney disease", labCode: "33914-3", labName: "eGFR", domain: "renal" },
    { cond: "Diabetes", labCode: "39156-5", labName: "Body Mass Index", domain: "general" },
    { cond: "Diabetes", labCode: "2093-3", labName: "Total Cholesterol", domain: "cardiovascular" },
    { cond: "Hypertension", labCode: "2160-0", labName: "Creatinine", domain: "renal" },
  ];

  for (const { cond, labCode, labName, domain } of labCondPairs) {
    const values: number[] = [];
    for (const [patientId, condSet] of patientConditionSets) {
      const hasCond = [...condSet].some((c) => c.toLowerCase().includes(cond.toLowerCase()));
      if (!hasCond) continue;

      const obs = ds.byPatient.observations.get(patientId);
      if (!obs) continue;
      const matching = obs
        .filter((o) => o.code === labCode && o.type === "numeric")
        .sort((a, b) => b.date.localeCompare(a.date));
      if (matching.length > 0) {
        const val = parseFloat(matching[0].value);
        if (!isNaN(val)) values.push(val);
      }
    }
    if (values.length === 0) continue;

    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    questions.push({
      id: id(),
      type: "cohort",
      question: `What is the average most-recent ${labName} value for patients with ${cond}?`,
      answer: `${avg.toFixed(2)} (across ${values.length} patients)`,
      patientIds: [],
      domain,
      supportingRecordIds: [],
    });
  }

  // 3. Patients on a specific medication (~5)
  const topMeds = [...profile.medicationCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [medName] of topMeds) {
    let count = 0;
    for (const [, medSet] of patientMedSets) {
      if (medSet.has(medName)) count++;
    }
    questions.push({
      id: id(),
      type: "cohort",
      question: `How many patients have been prescribed ${medName}?`,
      answer: `${count} patients`,
      patientIds: [],
      domain: "medications",
      supportingRecordIds: [],
    });
  }

  // 4. Percentage of diabetic patients with A1C > 7.0 (~1)
  {
    let diabeticCount = 0;
    let highA1cCount = 0;
    for (const [patientId, condSet] of patientConditionSets) {
      const hasDiabetes = [...condSet].some((c) =>
        c.toLowerCase().includes("diabetes")
      );
      if (!hasDiabetes) continue;
      diabeticCount++;

      const obs = ds.byPatient.observations.get(patientId);
      if (!obs) continue;
      const a1c = obs
        .filter((o) => o.code === "4548-4" && o.type === "numeric")
        .sort((a, b) => b.date.localeCompare(a.date));
      if (a1c.length > 0 && parseFloat(a1c[0].value) > 7.0) {
        highA1cCount++;
      }
    }
    if (diabeticCount > 0) {
      const pct = ((highA1cCount / diabeticCount) * 100).toFixed(1);
      questions.push({
        id: id(),
        type: "cohort",
        question: `What percentage of diabetic patients have a most recent A1C value above 7.0%?`,
        answer: `${pct}% (${highA1cCount} of ${diabeticCount} diabetic patients)`,
        patientIds: [],
        domain: "diabetes",
        supportingRecordIds: [],
      });
    }
  }

  // 5. Most common conditions by age group (~4)
  const ageGroups = [
    { label: "18-40", min: 18, max: 40 },
    { label: "41-60", min: 41, max: 60 },
    { label: "61-80", min: 61, max: 80 },
    { label: "80+", min: 80, max: 200 },
  ];

  const now = new Date();
  for (const group of ageGroups) {
    const condCounts = new Map<string, number>();
    let patientCount = 0;

    for (const patient of ds.patients) {
      const age = now.getFullYear() - new Date(patient.birthDate).getFullYear();
      if (age < group.min || age > group.max) continue;
      if (patient.deathDate) continue;
      patientCount++;

      const conds = patientConditionSets.get(patient.id);
      if (!conds) continue;
      for (const desc of conds) {
        condCounts.set(desc, (condCounts.get(desc) ?? 0) + 1);
      }
    }

    if (patientCount === 0) continue;
    const top5 = [...condCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name} (${count})`);

    questions.push({
      id: id(),
      type: "cohort",
      question: `What are the 5 most common conditions among living patients aged ${group.label}?`,
      answer: top5.join("; "),
      patientIds: [],
      domain: "conditions",
      supportingRecordIds: [],
    });
  }

  return questions;
}
