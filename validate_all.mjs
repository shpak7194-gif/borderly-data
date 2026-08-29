import { spawnSync } from "node:child_process";
import fs from "node:fs";

for (const script of fs.readdirSync(".").filter((name) => name.endsWith(".mjs")).sort()) {
  const check = spawnSync(process.execPath, ["--check", script], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (check.error) throw check.error;
  if (check.status !== 0) process.exit(check.status ?? 1);
}
console.log("Borderly data scripts are syntactically valid.");

const scripts = [
  "validate_taxonomy.mjs",
  "validate_visa_data.mjs",
  "validate_passport_index_exactness.mjs",
  "validate_provenance.mjs",
  "validate_territory_official_policies.mjs",
  "validate_official_evidence.mjs",
  "validate_monitoring_config.mjs",
  "validate_commercial_licenses.mjs",
  "validate_entry_requirements.mjs",
  "validate_entry_guides.mjs",
  "validate_release_artifacts.mjs",
  "test_freedom_registry.mjs",
  "test_entry_requirements_safety.mjs",
  "test_territory_safety.mjs",
  "test_external_source_monitoring.mjs",
  "test_official_source_monitoring.mjs",
  "test_official_evidence.mjs",
  "test_monitor_status.mjs",
  "test_update_pipeline.mjs",
  "audit_data_quality.mjs",
  "audit_territories.mjs",
];

for (const script of scripts) {
  console.log(`\n==> ${script}`);
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nAll Borderly data checks passed.");
