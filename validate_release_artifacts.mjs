import fs from "node:fs";
import {
  RELEASE_SCHEMA_VERSION,
  safeReleaseFile,
  sha256,
} from "./release_contract.mjs";

const read = (name) => JSON.parse(fs.readFileSync(name, "utf8"));

function validateManifest({ manifestFile, latestFile, expectedCountField, arrayField }) {
  const manifest = read(manifestFile);
  if (manifest.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    throw new Error(`${manifestFile}: unsupported schemaVersion`);
  }
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    throw new Error(`${manifestFile}: invalid version`);
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.databaseSha256 ?? "")) {
    throw new Error(`${manifestFile}: invalid databaseSha256`);
  }
  if (!Number.isInteger(manifest.databaseBytes) || manifest.databaseBytes < 2) {
    throw new Error(`${manifestFile}: invalid databaseBytes`);
  }

  const releaseFile = safeReleaseFile(".", manifest.database);
  const releaseText = fs.readFileSync(releaseFile, "utf8");
  const latestText = fs.readFileSync(latestFile, "utf8");
  if (sha256(releaseText) !== manifest.databaseSha256) {
    throw new Error(`${manifestFile}: release SHA-256 mismatch`);
  }
  if (Buffer.byteLength(releaseText, "utf8") !== manifest.databaseBytes) {
    throw new Error(`${manifestFile}: release byte count mismatch`);
  }
  if (releaseText !== latestText) {
    throw new Error(`${manifestFile}: immutable release differs from ${latestFile}`);
  }

  const payload = JSON.parse(releaseText);
  if (payload.updated !== manifest.updated) {
    throw new Error(`${manifestFile}: updated date mismatch`);
  }
  if (payload.version !== undefined && payload.version !== manifest.version) {
    throw new Error(`${manifestFile}: payload version mismatch`);
  }
  if (payload.dataVersion !== undefined && payload.dataVersion !== manifest.version) {
    throw new Error(`${manifestFile}: payload dataVersion mismatch`);
  }
  if (expectedCountField) {
    const count = Array.isArray(payload[arrayField]) ? payload[arrayField].length : 0;
    if (manifest[expectedCountField] !== count) {
      throw new Error(`${manifestFile}: ${expectedCountField} mismatch`);
    }
  }
  return manifest;
}

const visaManifest = validateManifest({
  manifestFile: "version.json",
  latestFile: "visa_requirements.json",
});
if (
  visaManifest.taxonomyVersion !== 2 ||
  visaManifest.provenanceVersion !== 1 ||
  visaManifest.passportCount !== 199 ||
  visaManifest.destinationCount !== 248 ||
  visaManifest.rulesPerPassport !== 247
) {
  throw new Error("version.json: matrix contract mismatch");
}

validateManifest({
  manifestFile: "entry_requirements_version.json",
  latestFile: "entry_requirements.json",
  expectedCountField: "requirementCount",
  arrayField: "requirements",
});
validateManifest({
  manifestFile: "entry_guides_version.json",
  latestFile: "entry_guides.json",
  expectedCountField: "guideCount",
  arrayField: "guides",
});

console.log(`Release contract valid: visa v${visaManifest.version}, immutable files and SHA-256 verified.`);
