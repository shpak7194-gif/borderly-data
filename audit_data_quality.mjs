import fs from "node:fs";
import path from "node:path";
import {
  auditDatabaseQuality,
  writeJsonFile,
} from "./data_quality.mjs";

const read = (name) =>
  JSON.parse(fs.readFileSync(path.resolve(name), "utf8"));

const report = auditDatabaseQuality({
  database: read("visa_requirements.json"),
  destinationManifest: read("destinations.json"),
  officialRulePolicies: read("official_rule_policies.json"),
  specialMobilityWatches: read("special_mobility_watches.json"),
  territoryDerivations: read("territory_derivations.json"),
  baseDir: process.cwd(),
  today: process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10),
});

writeJsonFile("data_quality_audit.json", report);

for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);
if (!report.ok) {
  throw new Error(`Borderly Data v15 quality audit failed:\n${report.errors.join("\n")}`);
}

console.log(
  `OK Data v15: official=${report.metrics.officialProtectedPairs}, ` +
    `regressions=${report.metrics.regressionRules}, freedom=${report.metrics.freedomRules}`
);
