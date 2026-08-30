import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  classifyTravelerAction,
  evidenceQuoteSha256,
  evidenceFreshnessState,
  validateOfficialEvidenceRegistry,
} from "./official_evidence_contract.mjs";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

assert.equal(
  classifyTravelerAction({
    freedomOfMovement: true,
    preTravelAction: "none",
    issuedAt: "none",
    inPersonStepRequired: false,
  }),
  "freedom"
);
assert.equal(
  classifyTravelerAction({
    freedomOfMovement: false,
    preTravelAction: "none",
    issuedAt: "none",
    inPersonStepRequired: false,
  }),
  "visa free"
);
assert.equal(
  classifyTravelerAction({
    freedomOfMovement: false,
    preTravelAction: "electronic-authorization",
    issuedAt: "before-travel",
    inPersonStepRequired: false,
  }),
  "eta"
);
assert.equal(
  classifyTravelerAction({
    freedomOfMovement: false,
    preTravelAction: "electronic-visa",
    issuedAt: "before-travel",
    inPersonStepRequired: false,
  }),
  "e-visa"
);
assert.equal(
  classifyTravelerAction({
    freedomOfMovement: false,
    preTravelAction: "none",
    issuedAt: "border",
    inPersonStepRequired: false,
  }),
  "visa on arrival"
);
assert.equal(
  classifyTravelerAction({
    freedomOfMovement: false,
    preTravelAction: "in-person-visa",
    issuedAt: "before-travel",
    inPersonStepRequired: true,
  }),
  "visa required"
);
assert.throws(
  () =>
    classifyTravelerAction({
      freedomOfMovement: false,
      preTravelAction: "arrival-form",
      issuedAt: "before-travel",
      inPersonStepRequired: false,
    }),
  /Unknown pre-travel action/
);

assert.deepEqual(
  evidenceFreshnessState({
    checkedAt: "2026-07-30",
    today: "2026-08-29",
    freshForDays: 30,
    staleAfterDays: 90,
  }),
  { state: "fresh", ageDays: 30 }
);
assert.equal(
  evidenceFreshnessState({
    checkedAt: "2026-07-29",
    today: "2026-08-29",
    freshForDays: 30,
    staleAfterDays: 90,
  }).state,
  "aging"
);
assert.equal(
  evidenceFreshnessState({
    checkedAt: "2026-05-30",
    today: "2026-08-29",
    freshForDays: 30,
    staleAfterDays: 90,
  }).state,
  "stale"
);

const registry = readJson("official_rule_evidence.json");
const officialRulePolicies = readJson("official_rule_policies.json");
const database = readJson("visa_requirements.json");
const destinationManifest = readJson("destinations.json");
const taxonomy = readJson("visa_status_taxonomy.json");
const args = {
  registry,
  officialRulePolicies,
  database,
  destinationManifest,
  allowedStatuses: new Set(taxonomy.statuses.map((item) => item.value)),
  today: "2026-08-29",
};
const validation = validateOfficialEvidenceRegistry(args);
assert.equal(validation.ok, true, validation.errors.join("\n"));
assert.equal(validation.entries.length, 10);
assert.equal(validation.coveredPairs.size, 47);

const tamperedRegistry = structuredClone(registry);
tamperedRegistry.entries[0].quoteFragments[0] += " changed";
const tampered = validateOfficialEvidenceRegistry({ ...args, registry: tamperedRegistry });
assert.equal(tampered.ok, false);
assert(tampered.errors.some((message) => message.includes("quoteSha256")));

const missingDurationRegistry = structuredClone(registry);
const durationEntry = missingDurationRegistry.entries.find(
  (entry) => entry.id === "taiwan-oman-14-day-visa-free-evidence"
);
durationEntry.quoteFragments = [
  "Nationals of Oman are eligible for the visa-exemption program.",
];
durationEntry.quoteSha256 = evidenceQuoteSha256(durationEntry.quoteFragments);
const missingDuration = validateOfficialEvidenceRegistry({
  ...args,
  registry: missingDurationRegistry,
});
assert.equal(missingDuration.ok, false);
assert(
  missingDuration.errors.some((message) =>
    message.includes("official quote does not contain the published stay length")
  )
);

const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "borderly-evidence-test-"));
try {
  const reportFile = path.join(temporaryDir, "official_evidence_report.json");
  const run = spawnSync(process.execPath, ["build_official_evidence_report.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BORDERLY_TODAY: "2026-08-30",
      OFFICIAL_EVIDENCE_REPORT_FILE: reportFile,
    },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const report = readJson(reportFile);
  assert.equal(report.overallState, "coverage-in-progress");
  assert.equal(report.summary.activePolicyPairCount, 47);
  assert.equal(report.summary.verifiedPolicyPairCount, 47);
  assert.equal(report.summary.missingPolicyEvidencePairCount, 0);
  assert.equal(report.summary.officialMetadataRuleCount, 8487);
  assert.equal(report.summary.territoryPolicyCount, 25);
  assert.equal(report.summary.verifiedTerritoryPolicyCount, 25);
  assert.equal(report.summary.territoryMatrixRuleCount, 4975);
  assert.equal(report.summary.verifiedTerritoryMatrixRuleCount, 4975);
  assert.equal(report.summary.missingTerritoryMatrixEvidenceRuleCount, 0);
  assert.equal(report.summary.evidenceCoveredRuleCount, 5022);
  assert.equal(report.summary.metadataOnlyRuleCount, 3465);
  assert.equal(report.territoryMatrixEvidence.length, 25);
  assert.equal(report.automaticPublicationAllowed, false);
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}

console.log("Official evidence contract, freshness and report tests passed.");
