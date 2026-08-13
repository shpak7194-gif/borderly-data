import fs from "node:fs";
import {
  RELEASE_SCHEMA_VERSION,
  jsonText,
  writeImmutableRelease,
} from "./release_contract.mjs";
import {
  BORDERLY_DATA_REPOSITORY,
  VISA_SOURCE_REGISTRY,
  buildVisaProvenance,
  normalizeExplicitRuleSource,
} from "./provenance_contract.mjs";

const database = JSON.parse(fs.readFileSync("visa_requirements.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("version.json", "utf8"));
const destinations = JSON.parse(fs.readFileSync("destinations.json", "utf8"));
const targetVersion = 13;
const updated = process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10);

if (manifest.version !== 12 || database.dataVersion !== 12) {
  throw new Error("Provenance migration must start from published visa data v12");
}
if (fs.existsSync(`releases/visa_requirements_v${targetVersion}.json`)) {
  throw new Error(`visa_requirements_v${targetVersion}.json already exists`);
}

for (const rules of Object.values(database.passports ?? {})) {
  for (const rule of Object.values(rules ?? {})) {
    normalizeExplicitRuleSource(rule);
  }
}

database.source = "Borderly Visa Data";
database.sourceUrl = BORDERLY_DATA_REPOSITORY;
database.sources = VISA_SOURCE_REGISTRY;
database.provenance = buildVisaProvenance(destinations);
database.updated = updated;
database.dataVersion = targetVersion;

const text = jsonText(database);
const release = writeImmutableRelease({
  prefix: "visa_requirements",
  version: targetVersion,
  text,
});
const nextManifest = {
  schemaVersion: RELEASE_SCHEMA_VERSION,
  taxonomyVersion: 1,
  provenanceVersion: 1,
  version: targetVersion,
  updated,
  database: release.relativePath,
  databaseSha256: release.sha256,
  databaseBytes: release.bytes,
  passportCount: 199,
  destinationCount: 248,
  rulesPerPassport: 247,
};

fs.writeFileSync("visa_requirements.json", text);
fs.writeFileSync("version.json", jsonText(nextManifest));

console.log(
  `Migrated visa data to v${targetVersion}: provenance v1, SHA-256 ${release.sha256}`
);
