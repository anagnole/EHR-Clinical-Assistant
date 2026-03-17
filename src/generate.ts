import { join } from "node:path";
import { parseSyntheaData } from "./parser/index.js";
import { profileDataset, generateAllQuestions } from "./questions/index.js";
import { curateQuestions } from "./curate.js";
import { writeSnapshot } from "./snapshot.js";

const DATA_DIR = join(import.meta.dirname, "..", "data", "synthea");
const OUT_DIR = join(import.meta.dirname, "..", "data", "generated");

console.log("=== ThesisBrainifai Data Generation ===\n");

// Step 1: Parse Synthea CSVs
const dataset = parseSyntheaData(DATA_DIR);

// Step 2: Profile the dataset
console.log("\nProfiling dataset...");
const profile = profileDataset(dataset);
console.log(`  Unique conditions: ${profile.conditionCounts.size}`);
console.log(`  Unique observation codes: ${profile.observationCoverage.size}`);
console.log(`  Unique medications: ${profile.medicationCounts.size}`);
console.log(`  Encounter classes: ${[...profile.encounterClassCounts.keys()].join(", ")}`);

// Step 3: Generate candidate questions
const allQuestions = generateAllQuestions(dataset, profile);

// Step 4: Curate evaluation set
console.log("\nCurating evaluation questions...");
const curated = curateQuestions(allQuestions);
console.log(`Selected ${curated.length} questions:`);
for (const type of ["simple-lookup", "multi-hop", "temporal", "cohort", "reasoning"] as const) {
  const count = curated.filter((q) => q.type === type).length;
  const domains = new Set(curated.filter((q) => q.type === type).map((q) => q.domain));
  console.log(`  ${type}: ${count} questions, ${domains.size} domains`);
}

// Step 5: Write outputs
console.log("\nWriting outputs...");
writeSnapshot(OUT_DIR, dataset, allQuestions, curated);

console.log("\n=== Done ===");
