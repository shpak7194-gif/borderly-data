import fs from "node:fs";

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));

const database = read("visa_requirements.json");
const version = read("version.json");
const destinationManifest = read("destinations.json");

const EXPECTED_PASSPORTS = 199;
const EXPECTED_DESTINATIONS = 248;
const GREENLAND_ID = "304";
const allowedStatuses = new Set([
  "home country",
  "freedom",
  "visa free",
  "eta",
  "e-visa",
  "visa on arrival",
  "visa required",
  "entry restricted",
  "no admission",
]);

const errors = [];
const passports = database.passports ?? {};
const passportIds = Object.keys(passports);
const passportIdSet = new Set(passportIds);
const destinations = destinationManifest.destinations ?? [];
const destinationIds = destinations.map((destination) => String(destination.numeric));
const destinationIdSet = new Set(destinationIds);
const destinationIso2Set = new Set(
  destinations.map((destination) => destination.iso2)
);

if (passportIds.length !== EXPECTED_PASSPORTS) {
  errors.push(
    `Expected ${EXPECTED_PASSPORTS} passports, found ${passportIds.length}`
  );
}
if (
  destinationManifest.destinationCount !== EXPECTED_DESTINATIONS ||
  destinations.length !== EXPECTED_DESTINATIONS ||
  destinationIdSet.size !== EXPECTED_DESTINATIONS ||
  destinationIso2Set.size !== EXPECTED_DESTINATIONS
) {
  errors.push(
    `Expected ${EXPECTED_DESTINATIONS} unique destinations, found ` +
      `${destinations.length} (numeric=${destinationIdSet.size}, ` +
      `iso2=${destinationIso2Set.size})`
  );
}
if (database.destinationCount !== EXPECTED_DESTINATIONS) {
  errors.push(
    `visa_requirements.json: expected destinationCount=${EXPECTED_DESTINATIONS}`
  );
}
if (!Array.isArray(database.sources) || database.sources.length < 3) {
  errors.push("visa_requirements.json: extended source metadata is missing");
}
for (const passportId of passportIds) {
  if (!destinationIdSet.has(passportId)) {
    errors.push(`${passportId}: passport is absent from destination manifest`);
  }
}

for (const [passportId, rules] of Object.entries(passports)) {
  const entries = Object.entries(rules ?? {});
  const expectedRuleIds = new Set(destinationIds);
  expectedRuleIds.delete(passportId);

  if (entries.length !== EXPECTED_DESTINATIONS - 1) {
    errors.push(
      `${passportId}: expected ${EXPECTED_DESTINATIONS - 1} destination rules, ` +
        `found ${entries.length}`
    );
  }
  if (rules?.[passportId]) {
    errors.push(`${passportId}: self rule must not be stored`);
  }

  for (const [destinationId, rule] of entries) {
    expectedRuleIds.delete(destinationId);
    if (!destinationIdSet.has(destinationId)) {
      errors.push(`${passportId} -> ${destinationId}: unsupported destination`);
    }
    if (!allowedStatuses.has(rule?.status)) {
      errors.push(
        `${passportId} -> ${destinationId}: invalid status ${rule?.status}`
      );
    }
    if (
      rule?.days !== undefined &&
      (!Number.isInteger(rule.days) || rule.days <= 0 || rule.days > 3660)
    ) {
      errors.push(`${passportId} -> ${destinationId}: invalid days ${rule.days}`);
    }
  }
  if (expectedRuleIds.size > 0) {
    errors.push(
      `${passportId}: missing destinations ${[...expectedRuleIds].slice(0, 12).join(",")}`
    );
  }
}

const expectedProtectedRules = new Map([
  ["643:112", "freedom"],
  ["112:643", "freedom"],
  ["643:762", "freedom"],
  ["643:233", "entry restricted"],
  ["643:246", "entry restricted"],
  ["643:428", "entry restricted"],
  ["643:440", "entry restricted"],
  ["643:616", "entry restricted"],
]);

for (const [key, expectedStatus] of expectedProtectedRules) {
  const [passportId, destinationId] = key.split(":");
  const rule = passports[passportId]?.[destinationId];
  if (rule?.status !== expectedStatus) {
    errors.push(
      `${key}: expected ${expectedStatus}, found ${rule?.status ?? "missing"}`
    );
  }
  if (!rule?.source || !rule?.sourceUrl || !rule?.updated) {
    errors.push(`${key}: protected rule has incomplete source metadata`);
  }
}

if (!Number.isInteger(version.version) || version.version < 1) {
  errors.push("version.json: invalid version");
}
if (version.database !== "visa_requirements.json") {
  errors.push("version.json: unexpected database filename");
}
if (version.updated !== database.updated) {
  errors.push("version.json and visa_requirements.json dates do not match");
}

if (errors.length > 0) {
  throw new Error(`Visa data validation failed:\n${errors.slice(0, 100).join("\n")}`);
}

const greenlandRules = passportIds.filter(
  (passportId) => passports[passportId]?.[GREENLAND_ID]
).length;
console.log(
  `OK: ${passportIds.length} passports × ${destinationIds.length} destinations, ` +
    `${greenlandRules} Greenland rules, version ${version.version}`
);
