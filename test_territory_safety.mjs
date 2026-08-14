import fs from "node:fs";
import path from "node:path";
import {
  auditTerritoryPolicies,
  loadQualityArtifacts,
  shouldFreezeExistingNonCoreRule,
} from "./data_quality.mjs";

const read = (name) => JSON.parse(fs.readFileSync(path.resolve(name), "utf8"));
const database = read("visa_requirements.json");
const destinationManifest = read("destinations.json");
const { policy } = loadQualityArtifacts(process.cwd());

const baseline = auditTerritoryPolicies({
  database,
  destinationManifest,
  baseDir: process.cwd(),
  today: process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10),
});
if (!baseline.ok) throw new Error(`Baseline territory audit is not clean: ${baseline.errors[0]}`);

// Territory-registry rules must remain frozen outside reviewed policy changes.
if (!shouldFreezeExistingNonCoreRule({
  currentRule: { status: "visa free", days: 30 },
  sourceKind: "territory-registry",
  policy,
})) {
  throw new Error("Existing territory registry rule is not frozen");
}
if (shouldFreezeExistingNonCoreRule({
  currentRule: { status: "visa free", days: 30 },
  sourceKind: "passport-index-core",
  policy,
})) {
  throw new Error("Core Passport Index rule was frozen by territory policy");
}

// A certified official matrix must catch a changed category or missing source.
const brokenOfficialMatrix = structuredClone(database);
brokenOfficialMatrix.passports["784"]["16"] = { status: "visa free" }; // UAE -> American Samoa
const officialMatrixAudit = auditTerritoryPolicies({
  database: brokenOfficialMatrix,
  destinationManifest,
  baseDir: process.cwd(),
});
if (
  officialMatrixAudit.ok ||
  !officialMatrixAudit.errors.some((line) => line.includes("784:16"))
) {
  throw new Error("Official territory-matrix regression was not detected");
}

// Certified parent linkage must catch a bad imported category.
const brokenMirror = structuredClone(database);
brokenMirror.passports["784"]["234"] = { status: "visa required" }; // UAE -> Faroe Islands
const mirrorAudit = auditTerritoryPolicies({
  database: brokenMirror,
  destinationManifest,
  baseDir: process.cwd(),
});
if (mirrorAudit.ok || !mirrorAudit.errors.some((line) => line.includes("784:234"))) {
  throw new Error("Mirror-parent regression was not detected");
}

// Shared official nationality list must catch a bad Dutch-Caribbean rule.
const brokenShared = structuredClone(database);
brokenShared.passports["784"]["533"] = { status: "visa required" }; // UAE -> Aruba
const sharedAudit = auditTerritoryPolicies({
  database: brokenShared,
  destinationManifest,
  baseDir: process.cwd(),
});
if (sharedAudit.ok || !sharedAudit.errors.some((line) => line.includes("784:533"))) {
  throw new Error("Shared official-list regression was not detected");
}

// Fixed non-visa permit semantics must not collapse back into a normal visa label.
const brokenFixed = structuredClone(database);
brokenFixed.passports["784"]["612"] = { status: "visa free" }; // UAE -> Pitcairn
const fixedAudit = auditTerritoryPolicies({
  database: brokenFixed,
  destinationManifest,
  baseDir: process.cwd(),
});
if (fixedAudit.ok || !fixedAudit.errors.some((line) => line.includes("784:612"))) {
  throw new Error("Fixed territory-policy regression was not detected");
}

console.log("OK Data v17 territory safety tests");
