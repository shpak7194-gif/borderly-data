import fs from "node:fs";
import {
  RELEASE_SCHEMA_VERSION,
  jsonText,
  writeImmutableRelease,
} from "./release_contract.mjs";

const read = (name) => JSON.parse(fs.readFileSync(name, "utf8"));
const write = (name, value) => fs.writeFileSync(name, jsonText(value));
const today = process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10);

function alreadyMigrated(manifest, prefix) {
  return (
    manifest.schemaVersion === RELEASE_SCHEMA_VERSION &&
    typeof manifest.databaseSha256 === "string" &&
    manifest.databaseSha256.length === 64 &&
    manifest.database === `releases/${prefix}_v${manifest.version}.json`
  );
}

function migrateVisaDatabase() {
  const manifest = read("version.json");
  const database = read("visa_requirements.json");

  if (alreadyMigrated(manifest, "visa_requirements")) {
    console.log(`Visa manifest already uses release contract v${manifest.version}.`);
    return;
  }

  const version = Number(manifest.version) + 1;
  if (!Number.isInteger(version) || version < 2) {
    throw new Error("version.json: invalid current version");
  }

  database.schemaVersion = 1;
  database.dataVersion = version;
  database.updated = today;
  const text = jsonText(database);
  const release = writeImmutableRelease({
    prefix: "visa_requirements",
    version,
    text,
  });

  write("visa_requirements.json", database);
  write("version.json", {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    taxonomyVersion: 1,
    version,
    updated: today,
    database: release.relativePath,
    databaseSha256: release.sha256,
    databaseBytes: release.bytes,
    passportCount: 199,
    destinationCount: 248,
    rulesPerPassport: 247,
  });
  console.log(`Migrated visa database to immutable release v${version}.`);
}

function migrateSecondaryDatabase({
  payloadFile,
  manifestFile,
  prefix,
  countField,
  arrayField,
}) {
  const manifest = read(manifestFile);
  const payload = read(payloadFile);
  const version = Number(manifest.version);
  if (!Number.isInteger(version) || version < 1 || payload.version !== version) {
    throw new Error(`${manifestFile}: payload version mismatch`);
  }

  const text = jsonText(payload);
  const release = writeImmutableRelease({ prefix, version, text });
  fs.writeFileSync(payloadFile, text);
  write(manifestFile, {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    version,
    updated: payload.updated,
    database: release.relativePath,
    databaseSha256: release.sha256,
    databaseBytes: release.bytes,
    [countField]: Array.isArray(payload[arrayField]) ? payload[arrayField].length : 0,
  });
  console.log(`Prepared immutable ${prefix} release v${version}.`);
}

migrateVisaDatabase();
migrateSecondaryDatabase({
  payloadFile: "entry_requirements.json",
  manifestFile: "entry_requirements_version.json",
  prefix: "entry_requirements",
  countField: "requirementCount",
  arrayField: "requirements",
});
migrateSecondaryDatabase({
  payloadFile: "entry_guides.json",
  manifestFile: "entry_guides_version.json",
  prefix: "entry_guides",
  countField: "guideCount",
  arrayField: "guides",
});
