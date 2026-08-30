import fs from "node:fs";
import { validateTerritoryMatrixEvidenceRegistry } from "./territory_matrix_evidence_contract.mjs";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const today = process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10);
const result = validateTerritoryMatrixEvidenceRegistry({
  registry: readJson("territory_matrix_evidence.json"),
  policyDatabase: readJson("territory_official_policies.json"),
  database: readJson("visa_requirements.json"),
  destinationManifest: readJson("destinations.json"),
  today,
});

for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
if (!result.ok) {
  throw new Error(
    `Territory matrix evidence validation failed:\n${result.errors
      .slice(0, 100)
      .join("\n")}`
  );
}
if (result.missingPolicyIds.length > 0) {
  throw new Error(
    `Territory matrix evidence is incomplete: ${result.missingPolicyIds.join(", ")}`
  );
}

console.log(
  `Territory matrix evidence valid: ${result.entries.length}/${result.policyCount} ` +
    `policies and ${result.coveredPairs.size}/${result.matrixRuleCount} rules are sealed.`
);
