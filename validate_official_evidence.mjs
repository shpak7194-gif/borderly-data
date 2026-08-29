import fs from "node:fs";
import { validateOfficialEvidenceRegistry } from "./official_evidence_contract.mjs";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function activeOnDate(value, today) {
  return (
    (!value?.validFrom || today >= value.validFrom) &&
    (!value?.validUntil || today <= value.validUntil)
  );
}

const today = process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10);
const registry = readJson("official_rule_evidence.json");
const officialRulePolicies = readJson("official_rule_policies.json");
const database = readJson("visa_requirements.json");
const destinationManifest = readJson("destinations.json");
const taxonomy = readJson("visa_status_taxonomy.json");
const allowedStatuses = new Set(taxonomy.statuses.map((item) => item.value));

const result = validateOfficialEvidenceRegistry({
  registry,
  officialRulePolicies,
  database,
  destinationManifest,
  allowedStatuses,
  today,
});

for (const warning of result.warnings) console.warn(`WARNING: ${warning}`);
if (!result.ok) {
  throw new Error(
    `Official evidence validation failed:\n${result.errors.slice(0, 100).join("\n")}`
  );
}

const activePolicies = officialRulePolicies.policies.filter((policy) =>
  activeOnDate(policy, today)
);
const activePolicyPairs = activePolicies.reduce(
  (total, policy) => total + policy.passportNumerics.length,
  0
);
const missingEvidencePairs = Math.max(0, activePolicyPairs - result.coveredPairs.size);

console.log(
  `Official evidence valid: ${result.entries.length} evidence entries cover ` +
    `${result.coveredPairs.size}/${activePolicyPairs} active policy pairs; ` +
    `${missingEvidencePairs} policy pairs remain in the explicit evidence backlog.`
);
