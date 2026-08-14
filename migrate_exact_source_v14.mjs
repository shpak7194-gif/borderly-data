import fs from "node:fs";
import path from "node:path";
import {
  auditPassportIndexExactness,
  buildPassportIndexSnapshotMetadata,
  canonicalPassportIndexText,
  isProtectedOfficialRule,
  normalizePassportIndexRule,
  PASSPORT_INDEX_SOURCE_FILE,
} from "./passport_index_contract.mjs";
import {
  BORDERLY_DATA_REPOSITORY,
  buildVisaProvenance,
  buildVisaSourceRegistry,
} from "./provenance_contract.mjs";
import {
  RELEASE_SCHEMA_VERSION,
  jsonText,
  writeImmutableRelease,
} from "./release_contract.mjs";

const baseDir = process.cwd();
const read = (name) =>
  JSON.parse(fs.readFileSync(path.resolve(baseDir, name), "utf8"));

const currentDatabase = read("visa_requirements.json");
const database = currentDatabase.dataVersion === 13
  ? currentDatabase
  : read("releases/visa_requirements_v13.json");
const version = read("version.json");
const destinationManifest = read("destinations.json");
const territoryRegistry = read("territory_audit_registry.json");
const sourcePath = process.env.UPSTREAM_FILE
  ? path.resolve(process.env.UPSTREAM_FILE)
  : path.resolve(baseDir, PASSPORT_INDEX_SOURCE_FILE);
const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

if (database.dataVersion !== 13 || ![13, 14].includes(version.version)) {
  throw new Error(
    `Data v14 migration requires v13 input; found database=${database.dataVersion}, ` +
      `manifest=${version.version}`
  );
}

const today = process.env.BORDERLY_TODAY ?? "2026-08-13";
const sourceText = canonicalPassportIndexText(source);
const snapshot = buildPassportIndexSnapshotMetadata({
  text: sourceText,
  updated: today,
  source,
  file: "releases/passport_index_source_v14.json",
});
const coreDestinations = destinationManifest.destinations.filter(
  (destination) => destination.sourceKind === "passport-index-core"
);
const numericToIso2 = new Map(
  coreDestinations.map((destination) => [
    String(destination.numeric),
    destination.iso2,
  ])
);

const next = structuredClone(database);
const transitions = {};
let semanticChanges = 0;
let exactRules = 0;
let protectedOfficialRules = 0;
let certifiedTerritoryChanges = 0;

for (const [passportId, row] of Object.entries(next.passports ?? {})) {
  const passportIso2 = numericToIso2.get(passportId);
  const sourceRow = source[passportIso2];
  if (!passportIso2 || !sourceRow) {
    throw new Error(`Passport Index source is missing passport ${passportId}`);
  }

  for (const destination of coreDestinations) {
    const destinationId = String(destination.numeric);
    if (destinationId === passportId) continue;
    const currentRule = row[destinationId];
    if (isProtectedOfficialRule(currentRule)) {
      protectedOfficialRules += 1;
      continue;
    }

    const sourceRule = sourceRow[destination.iso2];
    if (!sourceRule) {
      throw new Error(`${passportIso2}->${destination.iso2}: source rule is missing`);
    }
    const expected = normalizePassportIndexRule(sourceRule);
    const changed =
      currentRule?.status !== expected.status ||
      (currentRule?.days ?? null) !== (expected.days ?? null);
    if (changed) {
      semanticChanges += 1;
      const key = `${currentRule?.status ?? "missing"} -> ${expected.status}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
    }
    row[destinationId] = expected;
    exactRules += 1;
  }
}

// Certified territory mirrors must follow their parent after a core category
// refresh. Frozen/pending territories remain untouched until a dedicated
// official audit exists.
for (const territory of territoryRegistry.territories ?? []) {
  if (
    territory.policyMode !== "mirror-parent-category" &&
    territory.policyMode !== "mirror-parent-visa-category"
  ) {
    continue;
  }
  const destinationId = String(territory.destinationNumeric);
  const parentId = String(territory.parentNumeric);
  const parentIso2 = destinationManifest.destinations
    .find((destination) => String(destination.numeric) === parentId)
    ?.iso2?.toLowerCase();
  if (!parentIso2) throw new Error(`${territory.iso2}: mirror parent is missing`);
  const policyId = `territory-${territory.iso2.toLowerCase()}-mirror-${parentIso2}`;
  const freedomPassports = new Set(
    (territory.freedomPassportNumerics ?? []).map(String)
  );

  for (const [passportId, row] of Object.entries(next.passports ?? {})) {
    const parent = passportId === parentId
      ? { status: territory.selfFallback }
      : row[parentId];
    if (!parent?.status) {
      throw new Error(`${passportId}->${destinationId}: mirror parent rule is missing`);
    }
    const desiredStatus =
      territory.policyMode === "mirror-parent-visa-category" &&
      freedomPassports.has(passportId)
        ? "freedom"
        : territory.policyMode === "mirror-parent-visa-category" &&
            parent.status === "freedom"
          ? "visa free"
          : parent.status;
    const before = row[destinationId];
    const desired = {
      status: desiredStatus,
      ...(desiredStatus === parent.status && Number.isInteger(parent.days)
        ? { days: parent.days }
        : {}),
      territoryPolicyId: policyId,
    };
    const sourceRule = isProtectedOfficialRule(parent)
      ? parent
      : desiredStatus === before?.status && isProtectedOfficialRule(before)
        ? before
        : null;
    if (sourceRule) {
      for (const key of [
        "source",
        "sourceUrl",
        "sourceType",
        "updated",
        "validUntil",
        "note",
      ]) {
        if (sourceRule[key] !== undefined) desired[key] = sourceRule[key];
      }
    }
    if (JSON.stringify(before) !== JSON.stringify(desired)) {
      row[destinationId] = desired;
      certifiedTerritoryChanges += 1;
    }
  }
}

next.source = "Borderly Visa Data";
next.sourceUrl = BORDERLY_DATA_REPOSITORY;
next.updated = today;
next.schemaVersion = 1;
next.dataVersion = 14;
next.destinationCount = destinationManifest.destinationCount;
next.sources = buildVisaSourceRegistry(snapshot);
next.provenance = buildVisaProvenance(destinationManifest);
next.sourceSnapshots = {
  "passport-index-data": snapshot,
};
next.quality = {
  schemaVersion: 1,
  mode: "accuracy-first",
  passportIndexContract: "exact-snapshot-with-official-overrides",
  unverifiedCategoryChanges: "quarantined",
  freedomPolicy: "closed-registry",
  territoryAuditVersion: 1,
  territoryAuditDate: today,
  visaStatusAuthority: "published-database-only",
  clientOverridesAllowed: false,
  arrivalCardsAffectVisaStatus: false,
};

const exactness = auditPassportIndexExactness({
  database: next,
  source,
  destinationManifest,
});
if (!exactness.ok) {
  throw new Error(
    `Data v14 exactness migration failed:\n${exactness.errors.slice(0, 100).join("\n")}`
  );
}

const geToRu = next.passports?.["268"]?.["643"];
const geToGb = next.passports?.["268"]?.["826"];
if (geToRu?.status !== "visa free" || geToRu?.days !== 90) {
  throw new Error(`GE->RU regression: ${JSON.stringify(geToRu)}`);
}
if (geToGb?.status !== "visa required") {
  throw new Error(`GE->GB regression: ${JSON.stringify(geToGb)}`);
}

const sourceRelease = writeImmutableRelease({
  prefix: "passport_index_source",
  version: 14,
  text: sourceText,
  baseDir,
});
if (
  sourceRelease.relativePath !== snapshot.file ||
  sourceRelease.sha256 !== snapshot.sha256 ||
  sourceRelease.bytes !== snapshot.bytes
) {
  throw new Error("Passport Index immutable snapshot contract mismatch");
}

const databaseText = jsonText(next);
const release = writeImmutableRelease({
  prefix: "visa_requirements",
  version: 14,
  text: databaseText,
  baseDir,
});
const nextVersion = {
  schemaVersion: RELEASE_SCHEMA_VERSION,
  taxonomyVersion: 1,
  provenanceVersion: 1,
  version: 14,
  updated: today,
  database: release.relativePath,
  databaseSha256: release.sha256,
  databaseBytes: release.bytes,
  passportCount: Object.keys(next.passports).length,
  destinationCount: destinationManifest.destinationCount,
  rulesPerPassport: destinationManifest.destinationCount - 1,
  sourceSnapshots: next.sourceSnapshots,
};

fs.writeFileSync(path.resolve(baseDir, PASSPORT_INDEX_SOURCE_FILE), sourceText);
fs.writeFileSync(path.resolve(baseDir, "visa_requirements.json"), databaseText);
fs.writeFileSync(path.resolve(baseDir, "version.json"), jsonText(nextVersion));
fs.writeFileSync(
  path.resolve(baseDir, "source_sync_v14_report.json"),
  jsonText({
    schemaVersion: 1,
    generatedAt: today,
    fromVersion: 13,
    toVersion: 14,
    semanticChanges,
    exactRules,
    protectedOfficialRules,
    certifiedTerritoryChanges,
    exactness: exactness.metrics,
    snapshot,
    transitions: Object.fromEntries(
      Object.entries(transitions).sort((left, right) => right[1] - left[1])
    ),
    regressions: {
      "GE->RU": geToRu,
      "GE->GB": geToGb,
    },
  })
);

console.log(
  `Data v14 created: ${semanticChanges} semantic changes, ` +
    `${exactRules} exact Passport Index rules, ` +
    `${protectedOfficialRules} protected official rules, ` +
    `${certifiedTerritoryChanges} certified territory mirror refreshes.`
);
console.log(`Passport Index snapshot SHA-256: ${snapshot.sha256}`);
console.log(`Release SHA-256: ${release.sha256}`);
