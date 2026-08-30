import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { validateTerritoryMatrixEvidenceRegistry } from "./territory_matrix_evidence_contract.mjs";
import { collectTerritoryPolicySources } from "./territory_policy_contract.mjs";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const registry = readJson("territory_matrix_evidence.json");
const args = {
  registry,
  policyDatabase: readJson("territory_official_policies.json"),
  database: readJson("visa_requirements.json"),
  destinationManifest: readJson("destinations.json"),
  today: "2026-08-30",
};

const validation = validateTerritoryMatrixEvidenceRegistry(args);
assert.equal(validation.ok, true, validation.errors.join("\n"));
assert.equal(validation.entries.length, 25);
assert.equal(validation.policyCount, 25);
assert.equal(validation.coveredPairs.size, 4_975);
assert.equal(validation.matrixRuleCount, 4_975);
assert.deepEqual(validation.missingPolicyIds, []);

const monitoredSources = collectTerritoryPolicySources(args.policyDatabase);
assert.equal(monitoredSources.length, 23);
const monitoredUrls = new Set(monitoredSources.map((source) => source.url));
for (const sourceEvidence of registry.sourceEvidence) {
  assert(
    monitoredUrls.has(sourceEvidence.source.url),
    `${sourceEvidence.source.url} must be monitored for changes`
  );
}
const workflow = fs.readFileSync(
  ".github/workflows/update-visa-data.yml",
  "utf8"
);
assert.match(workflow, /check_territory_sources\.mjs --accept/);
assert.match(workflow, /inputs\.accept_official_fingerprints/);

const tamperedQuote = structuredClone(registry);
tamperedQuote.sourceEvidence[0].quoteFragments[0] += " changed";
const quoteResult = validateTerritoryMatrixEvidenceRegistry({
  ...args,
  registry: tamperedQuote,
});
assert.equal(quoteResult.ok, false);
assert(quoteResult.errors.some((message) => message.includes("quoteSha256")));

const tamperedGroups = structuredClone(registry);
const groupedEntry = tamperedGroups.entries.find(
  (entry) => entry.reviewedPassportGroupIds.length > 0
);
groupedEntry.reviewedPassportGroupIds = [];
const groupResult = validateTerritoryMatrixEvidenceRegistry({
  ...args,
  registry: tamperedGroups,
});
assert.equal(groupResult.ok, false);
assert(
  groupResult.errors.some((message) =>
    message.includes("reviewed passport groups do not match")
  )
);

const tamperedMatrixSeal = structuredClone(registry);
tamperedMatrixSeal.entries[0].reviewedMatrixSha256 = "0".repeat(64);
const matrixResult = validateTerritoryMatrixEvidenceRegistry({
  ...args,
  registry: tamperedMatrixSeal,
});
assert.equal(matrixResult.ok, false);
assert(
  matrixResult.errors.some((message) =>
    message.includes("reviewedMatrixSha256 does not match")
  )
);

const unsafeSeal = spawnSync(
  process.execPath,
  ["seal_territory_matrix_evidence.mjs"],
  { cwd: process.cwd(), encoding: "utf8" }
);
assert.notEqual(unsafeSeal.status, 0);
assert.match(`${unsafeSeal.stdout}\n${unsafeSeal.stderr}`, /--accept-reviewed/);

console.log("Territory matrix evidence coverage and tamper tests passed.");
