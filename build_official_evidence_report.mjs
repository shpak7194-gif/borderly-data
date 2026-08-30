import fs from "node:fs";
import { validateOfficialEvidenceRegistry } from "./official_evidence_contract.mjs";
import { validateTerritoryMatrixEvidenceRegistry } from "./territory_matrix_evidence_contract.mjs";

const OUTPUT_FILE = process.env.OFFICIAL_EVIDENCE_REPORT_FILE ??
  "official_evidence_report.json";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function activeOnDate(value, today) {
  return (
    (!value?.validFrom || today >= value.validFrom) &&
    (!value?.validUntil || today <= value.validUntil)
  );
}

function pairKey(passportNumeric, destinationNumeric) {
  return `${passportNumeric}:${destinationNumeric}`;
}

const today = process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10);
const registry = readJson("official_rule_evidence.json");
const officialRulePolicies = readJson("official_rule_policies.json");
const territoryRegistry = readJson("territory_matrix_evidence.json");
const territoryPolicyDatabase = readJson("territory_official_policies.json");
const database = readJson("visa_requirements.json");
const destinationManifest = readJson("destinations.json");
const taxonomy = readJson("visa_status_taxonomy.json");
const allowedStatuses = new Set(taxonomy.statuses.map((item) => item.value));
const destinationByNumeric = new Map(
  destinationManifest.destinations.map((item) => [String(item.numeric), item])
);

const validation = validateOfficialEvidenceRegistry({
  registry,
  officialRulePolicies,
  database,
  destinationManifest,
  allowedStatuses,
  today,
});
if (!validation.ok) {
  throw new Error(
    `Cannot build official evidence report:\n${validation.errors.slice(0, 100).join("\n")}`
  );
}
const territoryValidation = validateTerritoryMatrixEvidenceRegistry({
  registry: territoryRegistry,
  policyDatabase: territoryPolicyDatabase,
  database,
  destinationManifest,
  today,
});
if (!territoryValidation.ok) {
  throw new Error(
    `Cannot build territory matrix evidence report:\n${territoryValidation.errors
      .slice(0, 100)
      .join("\n")}`
  );
}

const activePolicies = officialRulePolicies.policies.filter((policy) =>
  activeOnDate(policy, today)
);
const activePolicyPairs = new Set();
const policyBacklog = [];
for (const policy of activePolicies) {
  const missingPassportNumerics = policy.passportNumerics
    .map(String)
    .filter((passportId) => {
      const key = pairKey(passportId, String(policy.destinationNumeric));
      activePolicyPairs.add(key);
      return !validation.coveredPairs.has(key);
    });
  if (missingPassportNumerics.length > 0) {
    policyBacklog.push({
      policyId: policy.id,
      label: policy.label,
      destinationNumeric: String(policy.destinationNumeric),
      destinationName:
        destinationByNumeric.get(String(policy.destinationNumeric))?.name ?? null,
      expectedPassportCount: policy.passportNumerics.length,
      verifiedPassportCount:
        policy.passportNumerics.length - missingPassportNumerics.length,
      missingPassportCount: missingPassportNumerics.length,
      missingPassportNumerics,
    });
  }
}

const officialMetadataRules = [];
for (const [passportNumeric, rules] of Object.entries(database.passports ?? {})) {
  for (const [destinationNumeric, rule] of Object.entries(rules ?? {})) {
    if (rule?.sourceType !== "official") continue;
    officialMetadataRules.push({
      key: pairKey(passportNumeric, destinationNumeric),
      passportNumeric,
      destinationNumeric,
      destinationName: destinationByNumeric.get(destinationNumeric)?.name ?? null,
      status: rule.status,
      days: rule.days ?? null,
      officialPolicyId: rule.officialPolicyId ?? null,
      source: rule.source ?? null,
      sourceUrl: rule.sourceUrl ?? null,
      updated: rule.updated ?? null,
    });
  }
}
const officialMetadataPairKeys = new Set(officialMetadataRules.map((item) => item.key));
const allEvidenceCoveredPairs = new Set([
  ...validation.coveredPairs,
  ...territoryValidation.coveredPairs,
]);
const evidenceCoveredOfficialPairs = new Set(
  [...allEvidenceCoveredPairs].filter((key) => officialMetadataPairKeys.has(key))
);
const metadataOnlyRules = officialMetadataRules.filter(
  (item) => !allEvidenceCoveredPairs.has(item.key)
);

const freshnessCounts = { fresh: 0, aging: 0, stale: 0 };
for (const entry of validation.entries) {
  if (Object.hasOwn(freshnessCounts, entry.freshness.state)) {
    freshnessCounts[entry.freshness.state] += 1;
  }
}
const territorySourceFreshness = new Map();
for (const entry of territoryValidation.entries) {
  for (const source of entry.sources) {
    const key = `${source.source.authority}|${source.source.url}`;
    territorySourceFreshness.set(key, source.freshness);
  }
}
for (const freshness of territorySourceFreshness.values()) {
  if (Object.hasOwn(freshnessCounts, freshness.state)) {
    freshnessCounts[freshness.state] += 1;
  }
}

let overallState = "healthy";
if (freshnessCounts.stale > 0) overallState = "stale-evidence";
else if (
  policyBacklog.length > 0 ||
  territoryValidation.missingPolicyIds.length > 0 ||
  metadataOnlyRules.length > 0
) {
  overallState = "coverage-in-progress";
}

const report = {
  schemaVersion: 1,
  checkedAt: today,
  scope: registry.scope,
  overallState,
  automaticPublicationAllowed: false,
  lastKnownGoodRetained: true,
  interpretationPolicy: registry.verificationPolicy,
  summary: {
    evidenceEntryCount:
      validation.entries.length + territoryValidation.entries.length,
    ruleEvidenceEntryCount: validation.entries.length,
    territoryMatrixEvidenceEntryCount: territoryValidation.entries.length,
    territoryMatrixSourceEvidenceCount: territoryRegistry.sourceEvidence.length,
    activePolicyCount: activePolicies.length,
    activePolicyPairCount: activePolicyPairs.size,
    verifiedPolicyPairCount: validation.coveredPairs.size,
    missingPolicyEvidencePairCount:
      activePolicyPairs.size - validation.coveredPairs.size,
    territoryPolicyCount: territoryValidation.policyCount,
    verifiedTerritoryPolicyCount:
      territoryValidation.policyCount - territoryValidation.missingPolicyIds.length,
    territoryMatrixRuleCount: territoryValidation.matrixRuleCount,
    verifiedTerritoryMatrixRuleCount: territoryValidation.coveredPairs.size,
    missingTerritoryMatrixEvidenceRuleCount:
      territoryValidation.matrixRuleCount - territoryValidation.coveredPairs.size,
    officialMetadataRuleCount: officialMetadataRules.length,
    evidenceCoveredRuleCount: evidenceCoveredOfficialPairs.size,
    metadataOnlyRuleCount: metadataOnlyRules.length,
    freshEvidenceCount: freshnessCounts.fresh,
    agingEvidenceCount: freshnessCounts.aging,
    staleEvidenceCount: freshnessCounts.stale,
  },
  evidence: validation.entries.map((entry) => ({
    id: entry.id,
    policyId: entry.policyId,
    destinationNumeric: entry.destinationNumeric,
    destinationName: destinationByNumeric.get(entry.destinationNumeric)?.name ?? null,
    passportNumerics: entry.passportNumerics,
    rule: entry.rule,
    sourceAuthority: entry.source.authority,
    sourceUrl: entry.source.url,
    sourceLanguage: entry.source.language,
    checkedAt: entry.source.checkedAt,
    freshness: entry.freshness.state,
    ageDays: entry.freshness.ageDays,
    active: entry.active,
  })),
  territoryMatrixEvidence: territoryValidation.entries.map((entry) => ({
    id: entry.id,
    policyId: entry.policyId,
    destinationIso2: entry.destinationIso2,
    destinationNumeric: entry.destinationNumeric,
    destinationName:
      destinationByNumeric.get(entry.destinationNumeric)?.name ?? null,
    coverageMode: entry.coverageMode,
    coveredRuleCount: entry.coveredRuleCount,
    reviewedAt: entry.reviewedAt,
    sources: entry.sources.map((item) => ({
      authority: item.source.authority,
      url: item.source.url,
      language: item.source.language,
      checkedAt: item.source.checkedAt,
      freshness: item.freshness.state,
      ageDays: item.freshness.ageDays,
    })),
  })),
  policyBacklog,
  territoryPolicyBacklog: territoryValidation.missingPolicyIds,
  metadataOnlySample: metadataOnlyRules.slice(0, 50),
  warnings: [...validation.warnings, ...territoryValidation.warnings],
  safetyNotes: [
    "External datasets are signals only and cannot create verified evidence.",
    "A source URL without an exact stored quote and a reviewed scope is metadata, not verified evidence.",
    "A complete official table, list or statutory annex covers a matrix only after manual comparison and policy/matrix sealing.",
    "This report never mutates visa_requirements.json or an Android release.",
  ],
};

fs.writeFileSync(OUTPUT_FILE, jsonText(report));
console.log(
  `Official evidence report: ${overallState}; ` +
    `${report.summary.evidenceCoveredRuleCount}/${report.summary.officialMetadataRuleCount} ` +
    `official-metadata rules have exact evidence.`
);
