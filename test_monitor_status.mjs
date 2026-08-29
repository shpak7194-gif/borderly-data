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
      metadataOnlyRuleCount: 0,
      staleEvidenceCount: 0,
    },
  });
  writeJson("territory_source_watch_candidate.json", {
    changedSourceCount: 0,
    unavailableSourceCount: 0,
  });
  fs.writeFileSync(path.join(temporaryDir, "update_result.txt"), "no_changes\n");

  const run = spawnSync(process.execPath, ["build_monitor_status.mjs"], {
    cwd: temporaryDir,
    env: {
      ...process.env,
      EXTERNAL_AUDIT_OUTCOME: "success",
      OFFICIAL_AUDIT_OUTCOME: "success",
      OFFICIAL_EVIDENCE_OUTCOME: "success",
      TERRITORY_AUDIT_OUTCOME: "success",
      UPDATE_OUTCOME: "success",
      VALIDATION_OUTCOME: "success",
    },
    encoding: "utf8",
  });
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
      metadataOnlyRuleCount: 8483,
      staleEvidenceCount: 0,
    },
  });
  const backlogRun = spawnSync(process.execPath, ["build_monitor_status.mjs"], {
    cwd: temporaryDir,
    env: {
      ...process.env,
      EXTERNAL_AUDIT_OUTCOME: "success",
      OFFICIAL_AUDIT_OUTCOME: "success",
      OFFICIAL_EVIDENCE_OUTCOME: "success",
      TERRITORY_AUDIT_OUTCOME: "success",
      UPDATE_OUTCOME: "success",
      VALIDATION_OUTCOME: "success",
    },
    encoding: "utf8",
  });
  assert.equal(backlogRun.status, 0, backlogRun.stderr);
  const backlogPayload = JSON.parse(
    fs.readFileSync(path.join(temporaryDir, "monitor_issues.json"))
  );
  assert.deepEqual(
    backlogPayload.issues.map((item) => item.key).sort(),
    ["external-source-review", "official-evidence-backlog", "source-conflict"]
  );

  console.log("Monitoring status and issue-deduplication payload tests passed.");
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}
