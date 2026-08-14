import fs from "node:fs";

const read = (name) => JSON.parse(fs.readFileSync(name, "utf8"));
const database = read("visa_requirements.json");
const taxonomy = read("visa_status_taxonomy.json");
const registry = read("territory_audit_registry.json");
const manifest = read("destinations.json");
const version = read("version.json");
const errors = [];

const forbidden = /(?:cc\s*by[-\s]*nc|noncommercial|kaggle-extended|ngshiheng\/henley-passport)/i;
const activeFiles = [
  "visa_requirements.json",
  version.database,
  "provenance_contract.mjs",
  "update_visa_data.mjs",
  ".github/workflows/update-visa-data.yml",
];

for (const filename of activeFiles) {
  if (!fs.existsSync(filename)) {
    errors.push(`Commercial source check: missing active file ${filename}`);
    continue;
  }
  if (forbidden.test(fs.readFileSync(filename, "utf8"))) {
    errors.push(`Commercial source check: forbidden non-commercial dependency in ${filename}`);
  }
}

if ((database.sources ?? []).length !== 2) {
  errors.push(`Expected two active source registries, found ${database.sources?.length ?? 0}`);
}
for (const source of database.sources ?? []) {
  if (forbidden.test(JSON.stringify(source))) {
    errors.push(`Forbidden source or license remains in registry: ${source.id}`);
  }
}

const noDataStatus = taxonomy.statuses?.find((item) => item.value === "no data");
if (!noDataStatus || noDataStatus.scoresForRanking !== false) {
  errors.push("Taxonomy must define non-scoring no data status");
}

const manifestById = new Map(
  (manifest.destinations ?? []).map((item) => [String(item.numeric), item])
);
const pending = (registry.territories ?? []).filter(
  (item) => item.linkageStatus === "pending-dedicated-audit"
);
if (pending.length !== 25) {
  errors.push(`Expected 25 pending official territory audits, found ${pending.length}`);
}
let checkedPendingRules = 0;
let verifiedPendingExceptions = 0;
for (const territory of pending) {
  const destinationId = String(territory.destinationNumeric);
  if (manifestById.get(destinationId)?.sourceKind !== "territory-registry") {
    errors.push(`${territory.iso2}: pending destination is outside territory registry`);
  }
  const policyId = `territory-${territory.iso2.toLowerCase()}-pending-official-audit`;
  for (const [passportId, row] of Object.entries(database.passports ?? {})) {
    if (passportId === destinationId) continue;
    checkedPendingRules += 1;
    const rule = row?.[destinationId];
    const verifiedException =
      Boolean(rule?.source && rule?.sourceUrl && rule?.updated) &&
      ["official", "corroborated"].includes(rule?.sourceType);
    if (verifiedException) {
      verifiedPendingExceptions += 1;
    } else if (rule?.status !== "no data" || rule?.territoryPolicyId !== policyId) {
      errors.push(`${passportId}->${destinationId}: unverified territory rule is publishable`);
      if (errors.length >= 100) break;
    }
  }
}

if (errors.length > 0) {
  throw new Error(`Commercial license validation failed:\n${errors.slice(0, 100).join("\n")}`);
}

console.log(
  `Commercial source policy valid: ${database.sources.length} active sources; ` +
    `${checkedPendingRules - verifiedPendingExceptions} unsupported territory pairs safely marked no data; ` +
    `${verifiedPendingExceptions} rule-specific official exceptions retained.`
);
