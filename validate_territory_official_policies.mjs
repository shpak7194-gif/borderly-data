import fs from "node:fs";
import {
  auditOfficialTerritoryPolicies,
  buildTerritoryPolicyContext,
  loadTerritoryOfficialPolicies,
} from "./territory_policy_contract.mjs";

const read = (name) => JSON.parse(fs.readFileSync(name, "utf8"));
const database = read("visa_requirements.json");
const destinationManifest = read("destinations.json");
const registry = read("territory_audit_registry.json");
const policyDatabase = loadTerritoryOfficialPolicies(process.cwd());
const context = buildTerritoryPolicyContext({
  policyDatabase,
  destinationManifest,
});
const errors = [];
const matrixEntries = (registry.territories ?? []).filter(
  (entry) => entry.policyMode === "official-status-matrix"
);

if (matrixEntries.length !== 25 || context.policyById.size !== 25) {
  errors.push(
    `Expected 25 registry matrices and 25 policies; found ` +
      `${matrixEntries.length} and ${context.policyById.size}`
  );
}
for (const entry of matrixEntries) {
  const policy = context.policyById.get(entry.officialPolicyId);
  if (!policy) {
    errors.push(`${entry.iso2}: missing policy ${entry.officialPolicyId}`);
  } else if (String(policy.destinationNumeric) !== String(entry.destinationNumeric)) {
    errors.push(`${entry.iso2}: policy destination mismatch`);
  }
}

const audit = auditOfficialTerritoryPolicies({
  database,
  destinationManifest,
  policyDatabase,
});
errors.push(...audit.errors);
if (errors.length > 0) {
  throw new Error(
    `Official territory policy validation failed:\n${errors.slice(0, 200).join("\n")}`
  );
}

console.log(
  `Official territory policies valid: ${context.policyById.size} destinations, ` +
    `${audit.checkedRules} ordinary-passport rules.`
);
