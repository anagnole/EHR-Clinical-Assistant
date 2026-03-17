import type { ParsedDataset } from "../parser/types.js";
import type { DataProfile, GroundTruthQuestion } from "./types.js";

let counter = 0;
function id() {
  return `RSN-${++counter}`;
}

export function generateReasoning(
  ds: ParsedDataset,
  profile: DataProfile
): GroundTruthQuestion[] {
  counter = 0;
  const questions: GroundTruthQuestion[] = [];
  const sortedPatients = [...ds.patients].sort((a, b) => a.id.localeCompare(b.id));

  // Build per-patient condition sets for reuse
  const patientConditionSets = new Map<string, Set<string>>();
  for (const c of ds.conditions) {
    let set = patientConditionSets.get(c.patientId);
    if (!set) {
      set = new Set();
      patientConditionSets.set(c.patientId, set);
    }
    set.add(c.description);
  }

  // 1. Diabetes control assessment from A1C trend (~8)
  let q1Count = 0;
  for (const patient of sortedPatients) {
    if (q1Count >= 12) break;
    const condSet = patientConditionSets.get(patient.id);
    if (!condSet) continue;
    const hasDiabetes = [...condSet].some((c) => c.toLowerCase().includes("diabetes"));
    if (!hasDiabetes) continue;

    const obs = ds.byPatient.observations.get(patient.id);
    if (!obs) continue;
    const a1cValues = obs
      .filter((o) => o.code === "4548-4" && o.type === "numeric")
      .sort((a, b) => a.date.localeCompare(b.date));
    if (a1cValues.length < 3) continue;

    const recent = a1cValues.slice(-5);
    const values = recent.map((o) => parseFloat(o.value));
    const lastVal = values[values.length - 1];
    const firstVal = values[0];

    let assessment: string;
    if (lastVal < 7.0) {
      assessment = "Well-controlled";
    } else if (lastVal >= 7.0 && lastVal < 9.0) {
      assessment = lastVal > firstVal ? "Worsening control" : "Suboptimal but stable/improving";
    } else {
      assessment = "Poorly controlled";
    }

    const trendData = recent.map((o) => `${o.date.slice(0, 10)}: ${o.value}%`);
    questions.push({
      id: id(),
      type: "reasoning",
      question: `Assess the diabetes control for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id}) based on their A1C history.`,
      answer: `${assessment}. A1C values: ${trendData.join(", ")}. Most recent: ${lastVal}%.`,
      patientIds: [patient.id],
      domain: "diabetes",
      supportingRecordIds: recent.map((o) => o.id),
    });
    q1Count++;
  }

  // 2. CKD progression risk from creatinine/eGFR (~6)
  let q2Count = 0;
  for (const patient of sortedPatients) {
    if (q2Count >= 10) break;
    const condSet = patientConditionSets.get(patient.id);
    if (!condSet) continue;
    const hasCKD = [...condSet].some((c) => c.toLowerCase().includes("chronic kidney disease"));
    if (!hasCKD) continue;

    const obs = ds.byPatient.observations.get(patient.id);
    if (!obs) continue;

    const creatinine = obs
      .filter((o) => o.code === "2160-0" && o.type === "numeric")
      .sort((a, b) => a.date.localeCompare(b.date));
    const egfr = obs
      .filter((o) => o.code === "33914-3" && o.type === "numeric")
      .sort((a, b) => a.date.localeCompare(b.date));

    if (creatinine.length < 2 && egfr.length < 2) continue;

    const supportingIds: string[] = [];
    const parts: string[] = [];

    if (creatinine.length >= 2) {
      const recentCr = creatinine.slice(-3);
      const crFirst = parseFloat(recentCr[0].value);
      const crLast = parseFloat(recentCr[recentCr.length - 1].value);
      const crTrend = crLast > crFirst * 1.1 ? "rising" : crLast < crFirst * 0.9 ? "falling" : "stable";
      parts.push(`Creatinine ${crTrend} (${recentCr.map((o) => `${o.date.slice(0, 10)}: ${o.value}`).join(", ")})`);
      supportingIds.push(...recentCr.map((o) => o.id));
    }

    if (egfr.length >= 2) {
      const recentEgfr = egfr.slice(-3);
      const egfrLast = parseFloat(recentEgfr[recentEgfr.length - 1].value);
      let stage: string;
      if (egfrLast >= 90) stage = "Stage 1";
      else if (egfrLast >= 60) stage = "Stage 2";
      else if (egfrLast >= 30) stage = "Stage 3";
      else if (egfrLast >= 15) stage = "Stage 4";
      else stage = "Stage 5";
      parts.push(`eGFR suggests ${stage} (latest: ${egfrLast.toFixed(1)})`);
      supportingIds.push(...recentEgfr.map((o) => o.id));
    }

    const crLastVal = creatinine.length > 0 ? parseFloat(creatinine[creatinine.length - 1].value) : 0;
    const risk = crLastVal > 2.0 ? "High" : crLastVal > 1.5 ? "Moderate" : "Low-moderate";

    questions.push({
      id: id(),
      type: "reasoning",
      question: `Assess the CKD progression risk for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id}) based on their lab trends.`,
      answer: `${risk} risk. ${parts.join(". ")}.`,
      patientIds: [patient.id],
      domain: "renal",
      supportingRecordIds: supportingIds,
    });
    q2Count++;
  }

  // 3. Potential drug interactions (~6)
  const interactionPairs = [
    { drugs: ["Warfarin", "Aspirin"], risk: "Increased bleeding risk" },
    { drugs: ["ACE inhibitor", "Potassium"], risk: "Hyperkalemia risk" },
    { drugs: ["Metformin", "Contrast"], risk: "Lactic acidosis risk" },
    { drugs: ["NSAID", "ACE inhibitor"], risk: "Reduced antihypertensive effect and renal risk" },
    { drugs: ["Statin", "Fibrate"], risk: "Increased myopathy risk" },
    { drugs: ["Insulin", "Sulfonylurea"], risk: "Hypoglycemia risk" },
  ];

  let q3Count = 0;
  for (const patient of sortedPatients) {
    if (q3Count >= 10) break;
    const meds = ds.byPatient.medications.get(patient.id);
    if (!meds) continue;
    const activeMeds = meds.filter((m) => !m.stopDate);
    if (activeMeds.length < 2) continue;

    for (const pair of interactionPairs) {
      if (q3Count >= 10) break;
      const matchA = activeMeds.filter((m) =>
        m.description.toLowerCase().includes(pair.drugs[0].toLowerCase())
      );
      const matchB = activeMeds.filter((m) =>
        m.description.toLowerCase().includes(pair.drugs[1].toLowerCase())
      );
      if (matchA.length === 0 || matchB.length === 0) continue;

      questions.push({
        id: id(),
        type: "reasoning",
        question: `Are there any potential drug interactions for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id})?`,
        answer: `Yes. ${pair.risk}: ${matchA[0].description} + ${matchB[0].description}.`,
        patientIds: [patient.id],
        domain: "medications",
        supportingRecordIds: [matchA[0].id, matchB[0].id],
      });
      q3Count++;
      break;
    }
  }

  // 4. Treatment plan consistency with guidelines (~6)
  let q4Count = 0;
  for (const patient of sortedPatients) {
    if (q4Count >= 10) break;
    const condSet = patientConditionSets.get(patient.id);
    if (!condSet) continue;

    const hasDiabetes = [...condSet].some((c) => c.toLowerCase().includes("diabetes"));
    const hasHypertension = [...condSet].some((c) => c.toLowerCase().includes("hypertension"));
    const hasHyperlipidemia = [...condSet].some((c) =>
      c.toLowerCase().includes("hyperlipidemia") || c.toLowerCase().includes("hypercholes")
    );
    if (!hasDiabetes && !hasHypertension && !hasHyperlipidemia) continue;

    const meds = ds.byPatient.medications.get(patient.id);
    const activeMeds = meds?.filter((m) => !m.stopDate) ?? [];
    const medDescs = activeMeds.map((m) => m.description.toLowerCase());

    const findings: string[] = [];
    const supportingIds: string[] = [];

    if (hasDiabetes) {
      const onMetformin = medDescs.some((d) => d.includes("metformin"));
      const onInsulin = medDescs.some((d) => d.includes("insulin"));
      if (onMetformin || onInsulin) {
        findings.push(`Diabetes: Treated with ${onMetformin ? "metformin" : ""}${onMetformin && onInsulin ? " and " : ""}${onInsulin ? "insulin" : ""} (guideline-concordant)`);
      } else {
        findings.push("Diabetes: No standard diabetes medication found (potential gap)");
      }
    }

    if (hasHypertension) {
      const onAntihypertensive = medDescs.some(
        (d) => d.includes("lisinopril") || d.includes("amlodipine") || d.includes("losartan") || d.includes("hydrochlorothiazide") || d.includes("valsartan")
      );
      if (onAntihypertensive) {
        findings.push("Hypertension: On antihypertensive (guideline-concordant)");
      } else {
        findings.push("Hypertension: No standard antihypertensive found (potential gap)");
      }
    }

    if (hasHyperlipidemia) {
      const onStatin = medDescs.some(
        (d) => d.includes("statin") || d.includes("simvastatin") || d.includes("atorvastatin") || d.includes("rosuvastatin")
      );
      if (onStatin) {
        findings.push("Hyperlipidemia: On statin therapy (guideline-concordant)");
      } else {
        findings.push("Hyperlipidemia: No statin found (potential gap)");
      }
    }

    if (findings.length === 0) continue;

    supportingIds.push(...activeMeds.map((m) => m.id));
    questions.push({
      id: id(),
      type: "reasoning",
      question: `Evaluate the treatment plan consistency for patient ${patient.firstName} ${patient.lastName} (ID: ${patient.id}) against clinical guidelines.`,
      answer: findings.join(". ") + ".",
      patientIds: [patient.id],
      domain: "guidelines",
      supportingRecordIds: supportingIds,
    });
    q4Count++;
  }

  return questions;
}
