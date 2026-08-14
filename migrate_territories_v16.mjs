import fs from "node:fs";
import path from "node:path";
import {
  auditDatabaseQuality,
  compareCandidateSafety,
  writeJsonFile,
} from "./data_quality.mjs";
import {
  auditPassportIndexExactness,
} from "./passport_index_contract.mjs";
import {
  RELEASE_SCHEMA_VERSION,
  jsonText,
  writeImmutableRelease,
} from "./release_contract.mjs";
import {
  applyOfficialTerritoryPolicies,
  auditOfficialTerritoryPolicies,
  loadTerritoryOfficialPolicies,
} from "./territory_policy_contract.mjs";

const read = (name) => JSON.parse(fs.readFileSync(path.resolve(name), "utf8"));
const database = read("visa_requirements.json");
const version = read("version.json");
const destinationManifest = read("destinations.json");
const policyDatabase = loadTerritoryOfficialPolicies(process.cwd());

const targetVersion = Math.max(16, Number(version.version) + 1);

const applied = applyOfficialTerritoryPolicies({
  database,
  destinationManifest,
  policyDatabase,
});
if (applied.changedRules === 0) {
  throw new Error("Official territory matrices are already up to date");
}
const next = applied.database;
next.updated = "2026-08-14";
next.dataVersion = targetVersion;
next.quality = {
  ...(next.quality ?? {}),
  territoryAuditVersion: 2,
  territoryAuditDate: "2026-08-14",
  officialTerritoryMatrices: 25,
  pendingTerritoryAudits: 0,
};

const matrixAudit = auditOfficialTerritoryPolicies({
  database: next,
  destinationManifest,
  policyDatabase,
});
if (!matrixAudit.ok) {
  throw new Error(`Official territory matrix audit failed:\n${matrixAudit.errors.join("\n")}`);
}

const qualityAudit = auditDatabaseQuality({
  database: next,
  destinationManifest,
  officialRulePolicies: read("official_rule_policies.json"),
  specialMobilityWatches: read("special_mobility_watches.json"),
  territoryDerivations: read("territory_derivations.json"),
  baseDir: process.cwd(),
  today: "2026-08-14",
});
if (!qualityAudit.ok) {
  throw new Error(`Data-quality audit failed:\n${qualityAudit.errors.slice(0, 200).join("\n")}`);
}

const sourceSnapshot = read("passport_index_source.json");
const passportIndexExactness = auditPassportIndexExactness({
  database: next,
  source: sourceSnapshot,
  destinationManifest,
});
if (!passportIndexExactness.ok) {
  throw new Error(
    `Passport Index exactness failed:\n${passportIndexExactness.errors.slice(0, 200).join("\n")}`
  );
}

const candidateSafety = compareCandidateSafety({
  before: database,
  after: next,
  destinationManifest,
  baseDir: process.cwd(),
});
if (!candidateSafety.ok) {
  throw new Error(`Candidate safety failed:\n${candidateSafety.errors.join("\n")}`);
}

const text = jsonText(next);
const release = writeImmutableRelease({
  prefix: "visa_requirements",
  version: targetVersion,
  text,
});
const nextVersion = {
  ...version,
  schemaVersion: RELEASE_SCHEMA_VERSION,
  version: targetVersion,
  updated: "2026-08-14",
  database: release.relativePath,
  databaseSha256: release.sha256,
  databaseBytes: release.bytes,
};

fs.writeFileSync("visa_requirements.json", text);
fs.writeFileSync("version.json", jsonText(nextVersion));
writeJsonFile(`territory_source_v${targetVersion}_report.json`, {
  schemaVersion: 1,
  generatedAt: "2026-08-14",
  sourceMode: policyDatabase.mode,
  policies: policyDatabase.policies.length,
  changedRules: applied.changedRules,
  changedByDestination: applied.changedByDestination,
  matrixAudit: {
    ok: matrixAudit.ok,
    checkedRules: matrixAudit.checkedRules,
  },
  passportIndexExactness: passportIndexExactness.metrics,
  candidateSafety: candidateSafety.metrics,
  release,
});
writeJsonFile("data_quality_review.json", {
  schemaVersion: 1,
  generatedAt: "2026-08-14",
  mode: "accuracy-first",
  quarantinedChanges: [],
  quarantinedCount: 0,
  candidateSafety,
  qualityAudit,
  passportIndexExactness,
});

console.log(
  `Published data v${targetVersion}: ${applied.changedRules} territory rules changed; ` +
    `${matrixAudit.checkedRules} official matrix rules verified; ` +
    `${release.relativePath}`
);
