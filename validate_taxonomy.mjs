import fs from "node:fs";

const read = (name) => JSON.parse(fs.readFileSync(name, "utf8"));

const taxonomy = read("visa_status_taxonomy.json");
const visaDatabase = read("visa_requirements.json");
const entryRequirements = read("entry_requirements.json");

if (taxonomy.schemaVersion !== 2 || !Array.isArray(taxonomy.statuses)) {
  throw new Error("visa_status_taxonomy.json: unsupported schema");
}

const statusValues = new Set();
const statusCodes = new Set();
const expectedTaxonomyV2 = new Map([
  ["freedom", "FREEDOM"],
  ["visa free", "VISA_FREE"],
  ["eta", "TRAVEL_AUTHORIZATION"],
  ["visa on arrival", "VISA_ON_ARRIVAL"],
  ["e-visa", "E_VISA"],
  ["visa required", "VISA_REQUIRED"],
  ["entry restricted", "ENTRY_RESTRICTED"],
  ["special permit", "SPECIAL_PERMIT"],
  ["mixed requirements", "MIXED_REQUIREMENTS"],
  ["no data", "NO_DATA"],
]);
for (const status of taxonomy.statuses) {
  if (!status.value || !status.code || !status.labelRu) {
    throw new Error("visa_status_taxonomy.json: incomplete status");
  }
  if (statusValues.has(status.value) || statusCodes.has(status.code)) {
    throw new Error(`visa_status_taxonomy.json: duplicate status ${status.value}`);
  }
  if (typeof status.scoresForRanking !== "boolean") {
    throw new Error(`${status.value}: scoresForRanking must be boolean`);
  }
  statusValues.add(status.value);
  statusCodes.add(status.code);
}
if (
  taxonomy.schemaVersion !== 2 ||
  statusValues.size !== expectedTaxonomyV2.size ||
  [...expectedTaxonomyV2].some(
    ([value, code]) => !statusValues.has(value) || !statusCodes.has(code) ||
      taxonomy.statuses.find((status) => status.value === value)?.code !== code
  )
) {
  throw new Error(
    "visa_status_taxonomy.json: taxonomy v2 changed incompatibly; publish a reviewed app/schema migration instead"
  );
}

const expectedScoredStatuses = new Set(["freedom", "visa free"]);
const actualScoredStatuses = new Set(
  taxonomy.statuses
    .filter((status) => status.scoresForRanking)
    .map((status) => status.value)
);
if (
  actualScoredStatuses.size !== expectedScoredStatuses.size ||
  [...expectedScoredStatuses].some((status) => !actualScoredStatuses.has(status))
) {
  throw new Error("Ranking taxonomy must score only freedom and visa free");
}

let ruleCount = 0;
for (const [passportId, row] of Object.entries(visaDatabase.passports ?? {})) {
  for (const [destinationId, rule] of Object.entries(row ?? {})) {
    ruleCount += 1;
    if (!statusValues.has(rule?.status)) {
      throw new Error(
        `${passportId}->${destinationId}: status is absent from canonical taxonomy: ${rule?.status}`
      );
    }
  }
}

const nonVisaTypes = new Set([
  "arrival_card",
  "pre_travel_registration",
  "health_declaration",
  "customs_declaration",
  "tourism_registration",
  "other_entry_formality",
]);
for (const requirement of entryRequirements.requirements ?? []) {
  if (!nonVisaTypes.has(requirement.type)) {
    throw new Error(`${requirement.id}: unknown non-visa formality ${requirement.type}`);
  }
  if (statusValues.has(requirement.type)) {
    throw new Error(`${requirement.id}: a visa status was stored as a formality`);
  }
}

console.log(
  `Taxonomy valid: ${statusValues.size} exclusive statuses, ${ruleCount} visa rules, ` +
    `${entryRequirements.requirements?.length ?? 0} separate entry formalities.`
);
