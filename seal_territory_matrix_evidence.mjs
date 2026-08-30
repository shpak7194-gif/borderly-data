import fs from "node:fs";
import { evidenceQuoteSha256 } from "./official_evidence_contract.mjs";
import { buildTerritoryPolicyContext } from "./territory_policy_contract.mjs";
import {
  territoryMatrixEvidenceRows,
  territoryMatrixEvidenceSha256,
  territoryPolicyEvidenceSha256,
} from "./territory_matrix_evidence_contract.mjs";

const ACCEPT_FLAG = "--accept-reviewed";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function referencedPassportGroupIds(policy) {
  return [
    ...new Set(
      (policy?.rules ?? []).flatMap((rule) => rule.passportGroupIds ?? [])
    ),
  ].sort();
}

function directPassportIso2s(policy) {
  return [
    ...new Set((policy?.rules ?? []).flatMap((rule) => rule.passportIso2s ?? [])),
  ].sort();
}

if (!process.argv.includes(ACCEPT_FLAG)) {
  throw new Error(
    `Refusing to seal evidence without ${ACCEPT_FLAG}. ` +
      "Use this command only after manually comparing every referenced official table, list or statutory annex."
  );
}

const registryFile = "territory_matrix_evidence.json";
const registry = readJson(registryFile);
const policyDatabase = readJson("territory_official_policies.json");
const database = readJson("visa_requirements.json");
const destinationManifest = readJson("destinations.json");
const context = buildTerritoryPolicyContext({
  policyDatabase,
  destinationManifest,
});

for (const sourceEvidence of registry.sourceEvidence ?? []) {
  sourceEvidence.quoteSha256 = evidenceQuoteSha256(
    sourceEvidence.quoteFragments
  );
}

for (const entry of registry.entries ?? []) {
  const policy = context.policyById.get(entry.policyId);
  if (!policy) throw new Error(`${entry.id}: unknown policyId ${entry.policyId}`);
  entry.destinationIso2 = policy.destinationIso2;
  entry.destinationNumeric = String(policy.destinationNumeric);
  entry.coveredRuleCount = territoryMatrixEvidenceRows({
    policy,
    database,
    destinationManifest,
    context,
  }).length;
  entry.reviewedPassportGroupIds = referencedPassportGroupIds(policy);
  entry.reviewedDirectPassportIso2s = directPassportIso2s(policy);
  entry.reviewedPolicySha256 = territoryPolicyEvidenceSha256({
    policy,
    context,
  });
  entry.reviewedMatrixSha256 = territoryMatrixEvidenceSha256({
    policy,
    database,
    destinationManifest,
    context,
  });
}

fs.writeFileSync(registryFile, jsonText(registry));
console.log(
  `Sealed ${registry.entries.length} reviewed territory matrices and ` +
    `${registry.sourceEvidence.length} official source excerpts.`
);
