import type { ParsedDataset } from "../parser/types.js";
import type { DataProfile, GroundTruthQuestion } from "./types.js";

let counter = 0;
function id() {
  return `SL-${++counter}`;
}

export function generateSimpleLookup(
  ds: ParsedDataset,
  profile: DataProfile
): GroundTruthQuestion[] {
  counter = 0;
  const questions: GroundTruthQuestion[] = [];

  // Pick patients deterministically — sort by ID, take first N with relevant data
  const sortedPatients = [...ds.patients].sort((a, b) => a.id.localeCompare(b.id));

  // 1. Most recent lab value for a patient (target ~8 questions)
  const labCodes = [
    { code: "4548-4", name: "Hemoglobin A1c", domain: "diabetes" },
    { code: "2160-0", name: "Creatinine", domain: "renal" },
    { code: "2093-3", name: "Total Cholesterol", domain: "cardiovascular" },
    { code: "6299-2", name: "Urea Nitrogen", domain: "renal" },
    { code: "2571-8", name: "Triglycerides", domain: "cardiovascular" },
    { code: "33914-3", name: "eGFR", domain: "renal" },
    { code: "2085-9", name: "HDL Cholesterol", domain: "cardiovascular" },
    { code: "18262-6", name: "LDL Cholesterol", domain: "cardiovascular" },
  ];

  for (const lab of labCodes) {
    // Find up to 2 patients with this observation
    let perCodeCount = 0;
    for (const patient of sortedPatients) {
      if (perCodeCount >= 2) break;
      const obs = ds.byPatient.observations.get(patient.id);
      if (!obs) continue;
      const matching = obs
        .filter((o) => o.code === lab.code && o.type === "numeric")
        .sort((a, b) => b.date.localeCompare(a.date));
      if (matching.length === 0) continue;

      const latest = matching[0];
      questions.push({
        id: id(),
        type: "simple-lookup",
        question: `What is the most recent ${lab.name} value for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id})?`,
        answer: `${latest.value} ${latest.units} (recorded ${latest.date.slice(0, 10)})`,
        patientIds: [patient.id],
        domain: lab.domain,
        supportingRecordIds: [latest.id],
      });
      perCodeCount++;
    }
  }

  // 2. Current medications list (~8 questions)
  let medCount = 0;
  for (const patient of sortedPatients) {
    if (medCount >= 12) break;
    const meds = ds.byPatient.medications.get(patient.id);
    if (!meds) continue;
    const active = meds.filter((m) => !m.stopDate);
    if (active.length < 2) continue;

    const sorted = active.sort((a, b) => a.description.localeCompare(b.description));
    const medNames = sorted.map((m) => m.description);
    questions.push({
      id: id(),
      type: "simple-lookup",
      question: `What medications is patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id}) currently taking?`,
      answer: medNames.join("; "),
      patientIds: [patient.id],
      domain: "medications",
      supportingRecordIds: sorted.map((m) => m.id),
    });
    medCount++;
  }

  // 3. Active conditions list (~8 questions)
  let condCount = 0;
  for (const patient of sortedPatients) {
    if (condCount >= 12) break;
    const conds = ds.byPatient.conditions.get(patient.id);
    if (!conds) continue;
    const active = conds.filter((c) => !c.stopDate);
    if (active.length < 2) continue;

    const sorted = active.sort((a, b) => a.description.localeCompare(b.description));
    const condNames = [...new Set(sorted.map((c) => c.description))];
    questions.push({
      id: id(),
      type: "simple-lookup",
      question: `What are the active conditions for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id})?`,
      answer: condNames.join("; "),
      patientIds: [patient.id],
      domain: "conditions",
      supportingRecordIds: sorted.map((c) => c.id),
    });
    condCount++;
  }

  // 4. Primary care provider (~8 questions)
  let pcpCount = 0;
  for (const patient of sortedPatients) {
    if (pcpCount >= 12) break;
    const encs = ds.byPatient.encounters.get(patient.id);
    if (!encs) continue;
    const wellness = encs
      .filter((e) => e.encounterClass === "wellness" || e.encounterClass === "outpatient")
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    if (wellness.length === 0) continue;

    const provider = ds.providerById.get(wellness[0].providerId);
    if (!provider) continue;

    questions.push({
      id: id(),
      type: "simple-lookup",
      question: `Who is the most recent primary care provider for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id})?`,
      answer: `${provider.name} (${provider.specialty})`,
      patientIds: [patient.id],
      domain: "providers",
      supportingRecordIds: [wellness[0].id],
    });
    pcpCount++;
  }

  // 5. Patient demographics (~8 questions)
  let demoCount = 0;
  for (const patient of sortedPatients) {
    if (demoCount >= 12) break;
    const age = new Date().getFullYear() - new Date(patient.birthDate).getFullYear();
    questions.push({
      id: id(),
      type: "simple-lookup",
      question: `What are the demographics for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id})?`,
      answer: `Born ${patient.birthDate}, Gender: ${patient.gender}, Race: ${patient.race}, Ethnicity: ${patient.ethnicity}, Location: ${patient.city}, ${patient.state}`,
      patientIds: [patient.id],
      domain: "demographics",
      supportingRecordIds: [],
    });
    demoCount++;
  }

  return questions;
}
