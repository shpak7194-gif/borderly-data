import fs from "node:fs";
import path from "node:path";
import { auditTerritoryPolicies, writeJsonFile } from "./data_quality.mjs";

const read = (name) => JSON.parse(fs.readFileSync(path.resolve(name), "utf8"));

const report = auditTerritoryPolicies({
  database: read("visa_requirements.json"),
  destinationManifest: read("destinations.json"),
  baseDir: process.cwd(),
  today: process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10),
});

writeJsonFile("territory_audit_report.json", report);
for (const warning of report.warnings) console.warn(`WARNING: ${warning}`);
if (!report.ok) {
  throw new Error(`Borderly Data v15 territory audit failed:\n${report.errors.slice(0, 100).join("\n")}`);
}

console.log(
  `OK Data v15 territories: coverage=${report.metrics.registryEntries}/${report.metrics.totalNonCore}, ` +
    `mirror=${report.metrics.mirrorParent}, shared=${report.metrics.sharedOfficialList}, ` +
    `fixed=${report.metrics.fixedStatus}, pending=${report.metrics.pendingDedicated}`
);
