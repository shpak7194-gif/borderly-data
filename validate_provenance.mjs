import fs from "node:fs";
import {
  PROVENANCE_SCHEMA_VERSION,
  VISA_SOURCE_REGISTRY,
  sourceIdForDestination,
} from "./provenance_contract.mjs";

const read = (name) => JSON.parse(fs.readFileSync(name, "utf8"));
const database = read("visa_requirements.json");
const destinationManifest = read("destinations.json");
const errors = [];

const allowedTypes = new Set(["official", "corroborated", "dataset", "derived"]);
const sources = database.sources ?? [];
const sourceById = new Map();

for (const source of sources) {
  if (!source.id || sourceById.has(source.id)) {
    errors.push(`Duplicate or missing source id: ${source.id}`);
    continue;
  }
  sourceById.set(source.id, source);
  if (!allowedTypes.has(source.type)) {
    errors.push(`${source.id}: unsupported source type ${source.type}`);
  }
  if (!source.name || !source.description) {
    errors.push(`${source.id}: name/description is missing`);
  }
  if (!String(source.url ?? "").startsWith("https://")) {
    errors.push(`${source.id}: source URL must use HTTPS`);
  }
}

for (const required of VISA_SOURCE_REGISTRY) {
  const actual = sourceById.get(required.id);
  if (!actual) {
    errors.push(`Required source is absent: ${required.id}`);
  } else if (actual.type !== required.type || actual.url !== required.url) {
    errors.push(`${required.id}: source contract changed unexpectedly`);
  }
}

const provenance = database.provenance ?? {};
if (provenance.schemaVersion !== PROVENANCE_SCHEMA_VERSION) {
  errors.push("visa_requirements.json: unsupported provenance schema");
}
const destinationSourceIds = provenance.destinationSourceIds ?? {};
const destinations = destinationManifest.destinations ?? [];
if (Object.keys(destinationSourceIds).length !== destinations.length) {
  errors.push(
    `Expected ${destinations.length} destination provenance entries, found ` +
      `${Object.keys(destinationSourceIds).length}`
  );
}

for (const destination of destinations) {
  const destinationId = String(destination.numeric);
  const expectedSourceId = sourceIdForDestination(destination);
  const actualSourceId = destinationSourceIds[destinationId];
  if (actualSourceId !== expectedSourceId) {
    errors.push(
      `${destination.iso2}: expected provenance ${expectedSourceId}, found ${actualSourceId}`
    );
  }
  if (!sourceById.has(actualSourceId)) {
    errors.push(`${destination.iso2}: unknown source id ${actualSourceId}`);
  }
}

const counts = {
  official: 0,
  corroborated: 0,
  dataset: 0,
  derived: 0,
};
let total = 0;

for (const [passportId, rules] of Object.entries(database.passports ?? {})) {
  for (const [destinationId, rule] of Object.entries(rules ?? {})) {
    total += 1;
    const hasNamedSource = Boolean(rule.source || rule.sourceUrl || rule.sourceType);
    if (hasNamedSource) {
      if (!rule.source || !String(rule.sourceUrl ?? "").startsWith("https://")) {
        errors.push(`${passportId}->${destinationId}: incomplete explicit source`);
        continue;
      }
      if (!new Set(["official", "corroborated"]).has(rule.sourceType)) {
        errors.push(
          `${passportId}->${destinationId}: invalid explicit sourceType ${rule.sourceType}`
        );
        continue;
      }
      counts[rule.sourceType] += 1;
      continue;
    }

    const sourceId = destinationSourceIds[destinationId];
    const source = sourceById.get(sourceId);
    if (!source) {
      errors.push(`${passportId}->${destinationId}: no effective provenance`);
      continue;
    }
    counts[source.type] += 1;
  }
}

if (Object.values(counts).reduce((sum, value) => sum + value, 0) !== total) {
  errors.push("Not every rule has exactly one effective provenance classification");
}
if (counts.official < 3000) {
  errors.push(`Official-source coverage unexpectedly low: ${counts.official}`);
}

if (errors.length) {
  throw new Error(`Provenance validation failed:\n${errors.slice(0, 100).join("\n")}`);
}

console.log(
  `Provenance valid: ${total} rules; official=${counts.official}, ` +
    `corroborated=${counts.corroborated}, dataset=${counts.dataset}, derived=${counts.derived}`
);
