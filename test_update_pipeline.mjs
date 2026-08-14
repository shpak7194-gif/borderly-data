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

  // Use the exact pinned Passport Index snapshot. Reconstructing the source
  // from the published matrix would accidentally copy official overrides back
  // into the general feed and would not test the real synchronization contract.
  const upstreamFile = path.join(temporaryDir, "passport_index_source.json");
  if (!fs.existsSync(upstreamFile)) {
    throw new Error("Pinned Passport Index snapshot is missing from the test copy");
  }

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

  // A genuine category change in the pinned source must be published instead
  // of being silently quarantined. AD -> AU is an ordinary, unprotected pair;
  // its three certified external-territory mirrors must refresh in the same run.
  const changedUpstream = JSON.parse(fs.readFileSync(upstreamFile, "utf8"));
  changedUpstream.AD.AU = { status: "e-visa" };
  fs.writeFileSync(upstreamFile, `${JSON.stringify(changedUpstream, null, 2)}\n`);
  const categoryResult = spawnSync(process.execPath, ["update_visa_data.mjs"], {
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
  if (categoryResult.status !== 0) {
    process.stdout.write(categoryResult.stdout ?? "");
    process.stderr.write(categoryResult.stderr ?? "");
    throw new Error(
      `Offline category-refresh test failed with exit ${categoryResult.status}`
    );
  }
  const categoryOutcome = fs
    .readFileSync(path.join(temporaryDir, "update_result.txt"), "utf8")
    .trim();
  if (categoryOutcome !== "updated") {
    throw new Error(`Expected updated from category refresh, got ${categoryOutcome}`);
  }
  const changedDatabase = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
  if (changedDatabase.passports?.["20"]?.["36"]?.status !== "e-visa") {
    throw new Error("Passport Index category change AD->AU was not published exactly");
  }
  for (const territoryId of ["162", "166", "574"]) {
    if (changedDatabase.passports?.["20"]?.[territoryId]?.status !== "e-visa") {
      throw new Error(`Certified Australia mirror ${territoryId} was not refreshed`);
    }
  }
  const exactness = spawnSync(
    process.execPath,
    ["validate_passport_index_exactness.mjs"],
    { cwd: temporaryDir, encoding: "utf8" }
  );
  if (exactness.status !== 0) {
    process.stdout.write(exactness.stdout ?? "");
    process.stderr.write(exactness.stderr ?? "");
    throw new Error("Published category refresh failed exactness validation");
  }

  console.log(
    "Offline update pipeline test passed: no-change run is atomic and " +
      "source category changes publish exactly."
  );
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}
