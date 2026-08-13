import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const sourceDir = process.cwd();
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "borderly-update-test-"));

const sha256 = (filename) => createHash("sha256")
  .update(fs.readFileSync(filename))
  .digest("hex");

try {
  fs.cpSync(sourceDir, temporaryDir, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}.git${path.sep}`),
  });

  const database = JSON.parse(
    fs.readFileSync(path.join(temporaryDir, "visa_requirements.json"), "utf8")
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(temporaryDir, "destinations.json"), "utf8")
  );
  const destinations = manifest.destinations;
  const byNumeric = new Map(destinations.map((item) => [String(item.numeric), item]));
  const byIso2 = new Map(destinations.map((item) => [item.iso2, item]));
  const passportIds = Object.keys(database.passports).sort((a, b) => Number(a) - Number(b));

  // Reconstruct a deterministic primary-source snapshot from the published
  // matrix. The updater should treat it as a no-change scheduled run.
  const upstream = {};
  for (const passportId of passportIds) {
    const passportIso2 = byNumeric.get(passportId)?.iso2;
    if (!passportIso2) throw new Error(`No ISO2 code for passport ${passportId}`);
    const row = {};
    for (const destination of destinations) {
      if (destination.sourceKind !== "passport-index-core") continue;
      const rule = database.passports[passportId][String(destination.numeric)];
      if (!rule) continue;
      row[destination.iso2] = {
        status: rule.status,
        ...(Number.isInteger(rule.days) ? { days: rule.days } : {}),
      };
    }
    upstream[passportIso2] = row;
  }
  const upstreamFile = path.join(temporaryDir, "test-upstream.json");
  fs.writeFileSync(upstreamFile, `${JSON.stringify(upstream)}\n`);

  const extendedCodes = [...new Set(
    destinations
      .filter((item) => item.sourceKind !== "derived-territory")
      .map((item) => item.sourceKind === "extended-fw-split" ? "FW" : item.iso2)
  )].sort();
  if (extendedCodes.length !== 227) {
    throw new Error(`Extended fixture must contain 227 destinations, got ${extendedCodes.length}`);
  }

  const toExtendedType = (status) => ({
    "visa free": "visa_free_access",
    freedom: "visa_free_access",
    eta: "electronic_travel_authorisation",
    "visa on arrival": "visa_on_arrival",
    "e-visa": "visa_online",
    "visa required": "visa_required",
    "entry restricted": "visa_required",
    "special permit": "visa_required",
    "mixed requirements": "visa_required",
  })[status] ?? "visa_required";

  const csv = ["from_country_code,to_country_code,requirement_type"];
  const fwDestination = destinations.find((item) => item.sourceKind === "extended-fw-split");
  for (const passportId of passportIds) {
    const passportIso2 = byNumeric.get(passportId).iso2;
    for (const destinationIso2 of extendedCodes) {
      const destination = destinationIso2 === "FW"
        ? fwDestination
        : byIso2.get(destinationIso2);
      const rule = destination
        ? database.passports[passportId][String(destination.numeric)]
        : null;
      csv.push(
        `${passportIso2},${destinationIso2},${toExtendedType(rule?.status ?? "visa free")}`
      );
    }
  }
  const extendedFile = path.join(temporaryDir, "test-extended.csv");
  fs.writeFileSync(extendedFile, `${csv.join("\n")}\n`);

  const databaseFile = path.join(temporaryDir, "visa_requirements.json");
  const beforeHash = sha256(databaseFile);
  const result = spawnSync(process.execPath, ["update_visa_data.mjs"], {
    cwd: temporaryDir,
    env: {
      ...process.env,
      UPSTREAM_FILE: upstreamFile,
      EXTENDED_SOURCE_FILE: extendedFile,
      OFFICIAL_CHECKS_OFFLINE: "1",
      BORDERLY_TODAY: database.updated,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Offline updater integration test failed with exit ${result.status}`);
  }
  const outcome = fs.readFileSync(path.join(temporaryDir, "update_result.txt"), "utf8").trim();
  if (outcome !== "no_changes") {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`Expected no_changes from deterministic update, got ${outcome}`);
  }
  if (sha256(databaseFile) !== beforeHash) {
    throw new Error("No-change updater test modified the published visa database");
  }
  if (!fs.existsSync(path.join(temporaryDir, "data_quality_review.json"))) {
    throw new Error("Updater did not produce a review report");
  }

  console.log("Offline update pipeline test passed: validated no-change run is atomic.");
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}
