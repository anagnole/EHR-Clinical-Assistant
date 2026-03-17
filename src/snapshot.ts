import { writeFileSync, createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ParsedDataset } from "./parser/types.js";
import type { GroundTruthQuestion } from "./questions/types.js";

function bundlePatient(patientId: string, ds: ParsedDataset) {
  return {
    patient: ds.patientById.get(patientId)!,
    encounters: ds.byPatient.encounters.get(patientId) ?? [],
    conditions: ds.byPatient.conditions.get(patientId) ?? [],
    medications: ds.byPatient.medications.get(patientId) ?? [],
    observations: ds.byPatient.observations.get(patientId) ?? [],
    procedures: ds.byPatient.procedures.get(patientId) ?? [],
  };
}

function writePatientBundles(filePath: string, ds: ParsedDataset): void {
  const stream = createWriteStream(filePath);
  stream.write("{\n");
  const patients = ds.patients;
  for (let i = 0; i < patients.length; i++) {
    const bundle = bundlePatient(patients[i].id, ds);
    const key = JSON.stringify(patients[i].id);
    stream.write(`  ${key}: ${JSON.stringify(bundle)}`);
    if (i < patients.length - 1) stream.write(",");
    stream.write("\n");
  }
  stream.write("}\n");
  stream.end();
}

export function writeSnapshot(
  outDir: string,
  ds: ParsedDataset,
  allQuestions: GroundTruthQuestion[],
  curatedQuestions: GroundTruthQuestion[]
): void {
  mkdirSync(outDir, { recursive: true });

  // Patient bundles — stream to avoid string length limit
  console.log("Writing patients.json...");
  writePatientBundles(join(outDir, "patients.json"), ds);

  // Providers
  console.log("Writing providers.json...");
  const providers: Record<string, { provider: typeof ds.providers[0]; organization: typeof ds.organizations[0] | null }> = {};
  for (const provider of ds.providers) {
    providers[provider.id] = {
      provider,
      organization: ds.organizationById.get(provider.organizationId) ?? null,
    };
  }
  writeFileSync(join(outDir, "providers.json"), JSON.stringify(providers, null, 2));

  // All candidate questions (ground truth)
  console.log("Writing ground-truth.json...");
  writeFileSync(join(outDir, "ground-truth.json"), JSON.stringify(allQuestions, null, 2));

  // Curated evaluation questions
  console.log("Writing evaluation-questions.json...");
  writeFileSync(join(outDir, "evaluation-questions.json"), JSON.stringify(curatedQuestions, null, 2));

  // Summary stats
  const stats = {
    patients: ds.patients.length,
    encounters: ds.encounters.length,
    conditions: ds.conditions.length,
    medications: ds.medications.length,
    observations: ds.observations.length,
    procedures: ds.procedures.length,
    providers: ds.providers.length,
    organizations: ds.organizations.length,
    totalCandidateQuestions: allQuestions.length,
    curatedQuestions: curatedQuestions.length,
    questionsByType: Object.fromEntries(
      ["simple-lookup", "multi-hop", "temporal", "cohort", "reasoning"].map((t) => [
        t,
        curatedQuestions.filter((q) => q.type === t).length,
      ])
    ),
  };
  console.log("Writing stats.json...");
  writeFileSync(join(outDir, "stats.json"), JSON.stringify(stats, null, 2));
}
