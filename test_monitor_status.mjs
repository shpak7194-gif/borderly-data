import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "borderly-monitor-test-"));
const writeJson = (name, value) =>
  fs.writeFileSync(path.join(temporaryDir, name), `${JSON.stringify(value, null, 2)}\n`);

try {
  fs.copyFileSync("build_monitor_status.mjs", path.join(temporaryDir, "build_monitor_status.mjs"));
  const monitorEnvironment = {
    ...process.env,
    EXTERNAL_AUDIT_OUTCOME: "success",
    OFFICIAL_AUDIT_OUTCOME: "success",
    OFFICIAL_EVIDENCE_OUTCOME: "success",
    TERRITORY_AUDIT_OUTCOME: "success",
    UPDATE_OUTCOME: "success",
    VALIDATION_OUTCOME: "success",
  };
  const runMonitor = () =>
    spawnSync(process.execPath, ["build_monitor_status.mjs"], {
      cwd: temporaryDir,
      env: monitorEnvironment,
      encoding: "utf8",
    });
  writeJson("external_dataset_diff.json", {
    overallState: "review-required",
    summary: { reviewRequiredSourceCount: 1, sourceConflictCount: 1 },
    sources: [
      {
        label: "candidate",
        state: "review-required",
        diff: { categoryChangeCount: 1, stayLengthChangeCount: 0, missingRuleCount: 0 },
      },
    ],
    conflicts: {
      conflictCount: 1,
      conflicts: [
        {
          passport: "AA",
          destination: "BB",
          sources: [
            { id: "one", rule: { status: "visa free", days: 30 } },
            { id: "two", rule: { status: "e-visa" } },
          ],
        },
      ],
    },
  });
  writeJson("source_freshness_report.json", { sources: [] });
  writeJson("official_source_review.json", {
    overallState: "healthy",
    summary: { reviewRequiredSourceCount: 0 },
    sources: [],
  });
  writeJson("official_evidence_report.json", {
    overallState: "healthy",
    summary: {
      activePolicyPairCount: 4,
      verifiedPolicyPairCount: 4,
      missingPolicyEvidencePairCount: 0,
      territoryPolicyCount: 25,
      verifiedTerritoryPolicyCount: 25,
      territoryMatrixRuleCount: 4975,
      verifiedTerritoryMatrixRuleCount: 4975,
      missingTerritoryMatrixEvidenceRuleCount: 0,
      metadataOnlyRuleCount: 0,
      staleEvidenceCount: 0,
    },
  });
  writeJson("territory_source_watch_candidate.json", {
    changedSourceCount: 0,
    unavailableSourceCount: 0,
  });
  fs.writeFileSync(path.join(temporaryDir, "update_result.txt"), "no_changes\n");

  const run = runMonitor();
  assert.equal(run.status, 0, run.stderr);
  const payload = JSON.parse(fs.readFileSync(path.join(temporaryDir, "monitor_issues.json")));
  assert.deepEqual(
    payload.issues.map((item) => item.key).sort(),
    ["external-source-review", "source-conflict"]
  );
  const status = JSON.parse(fs.readFileSync(path.join(temporaryDir, "monitor_status.json")));
  assert.equal(status.overallStatus, "review-required");
  assert.equal(status.lastKnownGoodRetained, true);
  assert.equal(status.publication.eligible, true);
  assert.equal(status.officialEvidence.state, "healthy");

  writeJson("official_evidence_report.json", {
    overallState: "coverage-in-progress",
    summary: {
      activePolicyPairCount: 47,
      verifiedPolicyPairCount: 4,
      missingPolicyEvidencePairCount: 43,
      territoryPolicyCount: 25,
      verifiedTerritoryPolicyCount: 25,
      territoryMatrixRuleCount: 4975,
      verifiedTerritoryMatrixRuleCount: 4975,
      missingTerritoryMatrixEvidenceRuleCount: 0,
      metadataOnlyRuleCount: 3465,
      staleEvidenceCount: 0,
    },
  });
  const backlogRun = runMonitor();
  assert.equal(backlogRun.status, 0, backlogRun.stderr);
  const backlogPayload = JSON.parse(
    fs.readFileSync(path.join(temporaryDir, "monitor_issues.json"))
  );
  assert.deepEqual(
    backlogPayload.issues.map((item) => item.key).sort(),
    ["external-source-review", "official-evidence-backlog", "source-conflict"]
  );

  writeJson("external_dataset_diff.json", {
    overallState: "source-unavailable",
    summary: { unavailableSourceCount: 1, sourceConflictCount: 0 },
    sources: [
      {
        id: "external-blocked",
        label: "external blocked",
        state: "unavailable",
        error: "HTTP 403",
      },
    ],
    conflicts: { conflictCount: 0, conflicts: [] },
  });
  writeJson("source_freshness_report.json", {
    sources: [
      {
        id: "supplementary-old",
        label: "supplementary old",
        role: "supplementary-candidate",
        freshness: "critical",
        sourceAgeDays: 120,
      },
    ],
  });
  writeJson("official_source_review.json", {
    overallState: "source-unavailable",
    summary: { unavailableSourceCount: 2, reviewRequiredSourceCount: 2 },
    sources: [
      { id: "official-one", label: "official one", state: "blocked", error: "HTTP 403" },
      { id: "official-two", label: "official two", state: "unavailable", error: "HTTP 503" },
    ],
  });
  writeJson("official_evidence_report.json", {
    overallState: "coverage-in-progress",
    summary: {
      activePolicyPairCount: 47,
      verifiedPolicyPairCount: 47,
      missingPolicyEvidencePairCount: 0,
      territoryPolicyCount: 25,
      verifiedTerritoryPolicyCount: 25,
      territoryMatrixRuleCount: 4975,
      verifiedTerritoryMatrixRuleCount: 4975,
      missingTerritoryMatrixEvidenceRuleCount: 0,
      metadataOnlyRuleCount: 3465,
      staleEvidenceCount: 0,
    },
  });
  writeJson("territory_source_watch_candidate.json", {
    changedSourceCount: 0,
    unavailableSourceCount: 10,
    unavailableSources: [
      { url: "https://government.example/blocked", error: "HTTP 403" },
    ],
  });

  const limitedRun = runMonitor();
  assert.equal(limitedRun.status, 0, limitedRun.stderr);
  const limitedPayload = JSON.parse(
    fs.readFileSync(path.join(temporaryDir, "monitor_issues.json"))
  );
  assert.deepEqual(
    limitedPayload.issues.map((item) => item.key),
    [],
    "Temporary access blocks and metadata-only evidence must not create Issues"
  );
  const limitedStatus = JSON.parse(
    fs.readFileSync(path.join(temporaryDir, "monitor_status.json"))
  );
  assert.equal(limitedStatus.overallStatus, "monitoring-limited");
  assert.equal(limitedStatus.monitoringLimitations.limitationCount, 3);
  assert.equal(limitedStatus.monitoringLimitations.unavailableSourceCount, 13);
  assert.equal(limitedStatus.publication.eligible, true);

  writeJson("source_freshness_report.json", {
    sources: [
      {
        id: "active-old",
        label: "active old",
        role: "active-snapshot",
        freshness: "critical",
        sourceAgeDays: 120,
        sourceCommitSha: "abc123",
      },
    ],
  });
  const activeStaleRun = runMonitor();
  assert.equal(activeStaleRun.status, 0, activeStaleRun.stderr);
  const activeStalePayload = JSON.parse(
    fs.readFileSync(path.join(temporaryDir, "monitor_issues.json"))
  );
  assert.deepEqual(
    activeStalePayload.issues.map((item) => item.key),
    ["source-freshness"],
    "Staleness of the active production snapshot must remain actionable"
  );

  writeJson("source_freshness_report.json", { sources: [] });
  writeJson("official_source_review.json", {
    overallState: "review-required",
    summary: { changedSourceCount: 1, unavailableSourceCount: 0 },
    sources: [
      { id: "official-changed", label: "official changed", state: "changed" },
    ],
  });
  writeJson("territory_source_watch_candidate.json", {
    changedSourceCount: 1,
    unavailableSourceCount: 0,
    changedSources: ["https://government.example/changed"],
  });
  const changedRun = runMonitor();
  assert.equal(changedRun.status, 0, changedRun.stderr);
  const changedPayload = JSON.parse(
    fs.readFileSync(path.join(temporaryDir, "monitor_issues.json"))
  );
  assert.deepEqual(
    changedPayload.issues.map((item) => item.key).sort(),
    ["official-source-review", "territory-source-review"],
    "Real official-page changes must remain actionable"
  );

  console.log("Monitoring status and issue-deduplication payload tests passed.");
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}
