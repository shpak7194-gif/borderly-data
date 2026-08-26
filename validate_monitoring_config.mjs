import fs from "node:fs";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertHttps(value, label) {
  assert(typeof value === "string" && value.startsWith("https://"), `${label} must use HTTPS`);
}

function assertUnique(values, label) {
  assert(new Set(values).size === values.length, `${label} must be unique`);
}

const destinations = readJson("destinations.json");
const destinationIso2 = new Set(destinations.destinations.map((destination) => destination.iso2));
const external = readJson("external_source_registry.json");
const official = readJson("official_destination_sources.json");
const fingerprints = readJson("official_source_fingerprints.json");
const monitorStatus = readJson("monitor_status.json");

assert(external.schemaVersion === 1, "external_source_registry.json: unsupported schema");
assert(Array.isArray(external.sources) && external.sources.length >= 3, "External source registry must contain at least three sources");
assert(
  external.publicationPolicy?.candidateChanges === "review-only" &&
    external.publicationPolicy?.categoryChangeRequiresOfficialConfirmation === true &&
    external.publicationPolicy?.sameSourceFamilyIsIndependentCorroboration === false &&
    external.publicationPolicy?.retainLastKnownGoodOnFailure === true,
  "External source publication safety policy is incomplete"
);
assert(
  Number.isInteger(external.freshnessPolicy?.warningAfterDays) &&
    Number.isInteger(external.freshnessPolicy?.criticalAfterDays) &&
    external.freshnessPolicy.warningAfterDays < external.freshnessPolicy.criticalAfterDays,
  "External freshness thresholds are invalid"
);
assertUnique(external.sources.map((source) => source.id), "External source ids");
for (const source of external.sources) {
  assert(/^[a-z0-9][a-z0-9-]+$/.test(source.id), `Invalid external source id ${source.id}`);
  assert(source.sourceFamily, `${source.id}: sourceFamily is required`);
  assertHttps(source.repositoryUrl, `${source.id}.repositoryUrl`);
  assertHttps(source.dataUrl, `${source.id}.dataUrl`);
  assertHttps(source.metadataUrl, `${source.id}.metadataUrl`);
  assert(source.licenseSpdx === "MIT", `${source.id}: only declared MIT candidates are configured`);
  assertHttps(source.licenseUrl, `${source.id}.licenseUrl`);
  assert(
    source.underlyingDataRights === "not-asserted-by-repository-license",
    `${source.id}: underlying-data rights caveat is required`
  );
  assert(
    ["passport-index-json", "passport-index-tidy-iso2-csv"].includes(source.format),
    `${source.id}: unsupported format`
  );
  assert(source.minimumPassportCount >= 199, `${source.id}: passport threshold is too low`);
  assert(source.minimumRuleCount >= 39000, `${source.id}: rule threshold is too low`);
  if (source.role !== "active-snapshot") {
    assert(source.publicationMode === "review-only", `${source.id}: candidate must be review-only`);
  }
}

assert(official.schemaVersion === 1, "official_destination_sources.json: unsupported schema");
assert(
  official.interpretationPolicy === "fingerprint-only-review-required",
  "Official source interpretation must remain review-only"
);
assert(Array.isArray(official.sources) && official.sources.length > 0, "Official source registry is empty");
assertUnique(official.sources.map((source) => source.id), "Official source ids");
for (const source of official.sources) {
  assert(/^[a-z0-9][a-z0-9-]+$/.test(source.id), `Invalid official source id ${source.id}`);
  assert(source.sourcePriority === 1, `${source.id}: destination authority must have priority 1`);
  assert(source.autoApply === false, `${source.id}: fingerprint monitor must not auto-apply rules`);
  assert(
    Array.isArray(source.destinationIso2) && source.destinationIso2.length > 0,
    `${source.id}: destinations are required`
  );
  assertUnique(source.destinationIso2, `${source.id} destinations`);
  for (const iso2 of source.destinationIso2) {
    assert(destinationIso2.has(iso2), `${source.id}: unknown destination ${iso2}`);
  }
  assert(Array.isArray(source.urls) && source.urls.length > 0, `${source.id}: urls are required`);
  source.urls.forEach((url, index) => assertHttps(url, `${source.id}.urls[${index}]`));
  assert(
    Array.isArray(source.requiredMarkerGroups) &&
      source.requiredMarkerGroups.length > 0 &&
      source.requiredMarkerGroups.every(
        (group) => Array.isArray(group) && group.length > 0 && group.every((marker) => marker === marker.toLowerCase())
      ),
    `${source.id}: requiredMarkerGroups must contain lowercase alternatives`
  );
  assert(
    Number.isInteger(source.refreshEveryDays) && source.refreshEveryDays >= 1,
    `${source.id}: invalid refresh interval`
  );
}

assert(fingerprints.schemaVersion === 1, "official_source_fingerprints.json: unsupported schema");
assert(Array.isArray(fingerprints.sources), "Official fingerprints must be an array");
assertUnique(fingerprints.sources.map((source) => source.id), "Official fingerprint ids");
const officialIds = new Set(official.sources.map((source) => source.id));
for (const fingerprint of fingerprints.sources) {
  assert(officialIds.has(fingerprint.id), `Unknown official fingerprint ${fingerprint.id}`);
  assert(/^[a-f0-9]{64}$/.test(fingerprint.normalizedSha256), `${fingerprint.id}: invalid SHA-256`);
  assertHttps(fingerprint.finalUrl, `${fingerprint.id}.finalUrl`);
}

assert(monitorStatus.schemaVersion === 1, "monitor_status.json: unsupported schema");
assert(typeof monitorStatus.overallStatus === "string", "monitor_status.json: overallStatus is required");
assert(Array.isArray(monitorStatus.issues), "monitor_status.json: issues must be an array");

const coveredDestinations = new Set(official.sources.flatMap((source) => source.destinationIso2));
console.log(
  `Monitoring config valid: ${external.sources.length} external candidates, ` +
    `${official.sources.length} official pages covering ${coveredDestinations.size} destinations.`
);
