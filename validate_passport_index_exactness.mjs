import crypto from "node:crypto";
import fs from "node:fs";
import {
  PASSPORT_INDEX_SOURCE_FILE,
  PASSPORT_INDEX_SOURCE_ID,
  PASSPORT_INDEX_SOURCE_URL,
  auditPassportIndexExactness,
  canonicalPassportIndexText,
} from "./passport_index_contract.mjs";

const read = (name) => JSON.parse(fs.readFileSync(name, "utf8"));
const database = read("visa_requirements.json");
const version = read("version.json");
const destinationManifest = read("destinations.json");
const sourceText = fs.readFileSync(PASSPORT_INDEX_SOURCE_FILE, "utf8");
const source = JSON.parse(sourceText);
const errors = [];

const canonicalText = canonicalPassportIndexText(source);
if (sourceText !== canonicalText) {
  errors.push(`${PASSPORT_INDEX_SOURCE_FILE}: snapshot is not canonical JSON`);
}

const snapshot = database.sourceSnapshots?.[PASSPORT_INDEX_SOURCE_ID];
const versionSnapshot = version.sourceSnapshots?.[PASSPORT_INDEX_SOURCE_ID];
if (!snapshot || !versionSnapshot) {
  errors.push("Passport Index snapshot metadata is missing from database/version manifest");
} else {
  const sha256 = crypto.createHash("sha256").update(sourceText, "utf8").digest("hex");
  const bytes = Buffer.byteLength(sourceText, "utf8");
  for (const [label, metadata] of [
    ["database", snapshot],
    ["version", versionSnapshot],
  ]) {
    if (metadata.schemaVersion !== 1) {
      errors.push(`${label}: unsupported Passport Index snapshot schema`);
    }
    if (!/^releases\/passport_index_source_v[1-9][0-9]*\.json$/.test(metadata.file ?? "")) {
      errors.push(`${label}: incorrect immutable Passport Index snapshot filename`);
    }
    if (metadata.sourceUrl !== PASSPORT_INDEX_SOURCE_URL) {
      errors.push(`${label}: incorrect Passport Index source URL`);
    }
    if (metadata.sha256 !== sha256 || metadata.bytes !== bytes) {
      errors.push(`${label}: Passport Index snapshot hash/size mismatch`);
    }
    if (metadata.passportCount !== 199 || metadata.ruleCount !== 39402) {
      errors.push(`${label}: Passport Index snapshot matrix contract mismatch`);
    }
  }
  if (JSON.stringify(snapshot) !== JSON.stringify(versionSnapshot)) {
    errors.push("Database and version manifest use different source snapshots");
  }
  const snapshotVersion = Number(
    snapshot.file?.match(/_v([1-9][0-9]*)\.json$/)?.[1]
  );
  if (!Number.isInteger(snapshotVersion) || snapshotVersion > version.version) {
    errors.push("Passport Index snapshot version is invalid for this data release");
  }
  if (snapshot.file && fs.existsSync(snapshot.file)) {
    const immutableText = fs.readFileSync(snapshot.file, "utf8");
    if (immutableText !== sourceText) {
      errors.push("Latest and immutable Passport Index snapshots differ");
    }
  } else {
    errors.push(`Immutable Passport Index snapshot is missing: ${snapshot.file}`);
  }
}

const sourceRegistryEntry = (database.sources ?? []).find(
  (sourceItem) => sourceItem.id === PASSPORT_INDEX_SOURCE_ID
);
if (
  !sourceRegistryEntry ||
  sourceRegistryEntry.snapshotSha256 !== snapshot?.sha256 ||
  sourceRegistryEntry.snapshotUpdated !== snapshot?.updated ||
  !String(sourceRegistryEntry.snapshotUrl ?? "").startsWith("https://") ||
  !String(sourceRegistryEntry.snapshotUrl ?? "").endsWith(snapshot?.file ?? "")
) {
  errors.push("Passport Index source registry does not identify the pinned snapshot");
}

const exactness = auditPassportIndexExactness({
  database,
  source,
  destinationManifest,
});
errors.push(...exactness.errors);

const geToRu = database.passports?.["268"]?.["643"];
const geToGb = database.passports?.["268"]?.["826"];
if (geToRu?.status !== "visa free" || geToRu?.days !== 90) {
  errors.push(`GE->RU must be visa free/90, found ${JSON.stringify(geToRu)}`);
}
if (geToGb?.status !== "visa required") {
  errors.push(`GE->GB must be visa required, found ${JSON.stringify(geToGb)}`);
}

if (database.quality?.arrivalCardsAffectVisaStatus !== false) {
  errors.push("Database must declare that arrival cards do not affect visa status");
}

if (errors.length > 0) {
  throw new Error(
    `Passport Index exactness validation failed:\n${errors.slice(0, 100).join("\n")}`
  );
}

console.log(
  `Passport Index exactness valid: ${exactness.metrics.exactRules} exact rules, ` +
    `${exactness.metrics.protectedOfficialRules} official overrides; ` +
    `snapshot ${snapshot.sha256}.`
);
