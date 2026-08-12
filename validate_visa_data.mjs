import fs from "node:fs";
import { auditDatabaseQuality } from "./data_quality.mjs";

const read = (name) =>
  JSON.parse(fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));

const database = read("visa_requirements.json");
const version = read("version.json");
const destinationManifest = read("destinations.json");
const officialRulePolicies = read("official_rule_policies.json");
const specialMobilityWatches = read("special_mobility_watches.json");
const territoryDerivations = read("territory_derivations.json");
const taxonomy = read("visa_status_taxonomy.json");

const EXPECTED_PASSPORTS = 199;
const EXPECTED_DESTINATIONS = 248;
const GREENLAND_ID = "304";
if (taxonomy.schemaVersion !== 1 || !Array.isArray(taxonomy.statuses)) {
  throw new Error("visa_status_taxonomy.json: unsupported schema");
}
const allowedStatuses = new Set(taxonomy.statuses.map((status) => status.value));

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
const today = process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10);

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

const policyIds = new Set();
const policyPairs = new Set();
if (
  officialRulePolicies.schemaVersion !== 1 ||
  !Array.isArray(officialRulePolicies.policies)
) {
  errors.push("official_rule_policies.json: unsupported or missing schema");
} else {
  for (const policy of officialRulePolicies.policies) {
    if (!policy.id || policyIds.has(policy.id)) {
      errors.push(`official_rule_policies.json: duplicate policy id ${policy.id}`);
    }
    policyIds.add(policy.id);

    if (!allowedStatuses.has(policy.rule?.status)) {
      errors.push(`${policy.id}: invalid protected status ${policy.rule?.status}`);
    }
    if (!destinationIdSet.has(String(policy.destinationNumeric))) {
      errors.push(`${policy.id}: unsupported destination ${policy.destinationNumeric}`);
    }
    if (!policy.source || !policy.sourceUrl || !policy.verifiedAt) {
      errors.push(`${policy.id}: incomplete official source metadata`);
    }

    for (const passportValue of policy.passportNumerics ?? []) {
      const passportId = String(passportValue);
      const destinationId = String(policy.destinationNumeric);
      const key = `${passportId}:${destinationId}`;
      if (!passportIdSet.has(passportId)) {
        errors.push(`${policy.id}: unsupported passport ${passportId}`);
      }
      if (policyPairs.has(key)) {
        errors.push(`${policy.id}: duplicate protected pair ${key}`);
      }
      policyPairs.add(key);

      const isActive =
        (!policy.validFrom || today >= policy.validFrom) &&
        (!policy.validUntil || today <= policy.validUntil);
      if (!isActive) continue;

      const rule = passports[passportId]?.[destinationId];
      if (
        rule?.status !== policy.rule.status ||
        (rule?.days ?? null) !== (policy.rule.days ?? null)
      ) {
        errors.push(
          `${key}: policy ${policy.id} expected ${policy.rule.status}` +
            `${policy.rule.days ? `/${policy.rule.days}` : ""}, found ` +
            `${rule?.status ?? "missing"}${rule?.days ? `/${rule.days}` : ""}`
        );
      }
      if (
        rule?.officialPolicyId !== policy.id ||
        !rule?.source ||
        !rule?.sourceUrl ||
        !rule?.updated
      ) {
        errors.push(`${key}: policy ${policy.id} has incomplete protection metadata`);
      }
    }
  }
}

if (policyPairs.size === 0) {
  errors.push("No official policy pairs are configured");
}

const expectedProtectedRules = new Map([
  ["643:112", "freedom"],
  ["112:643", "freedom"],
  ["643:762", "visa free"],
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

const taiwanToMoldova = passports["158"]?.["498"];
if (
  taiwanToMoldova?.status === "entry restricted" ||
  taiwanToMoldova?.status === "no admission"
) {
  errors.push(
    `158:498: Taiwan → Moldova must not be classified as closed entry; found ` +
      `${taiwanToMoldova.status}`
  );
}

if (!Number.isInteger(version.version) || version.version < 1) {
  errors.push("version.json: invalid version");
}
if (version.schemaVersion !== 1 || version.taxonomyVersion !== taxonomy.schemaVersion) {
  errors.push("version.json: unsupported release/taxonomy schema");
}
if (version.database !== `releases/visa_requirements_v${version.version}.json`) {
  errors.push("version.json: database must use an immutable versioned filename");
}
if (database.schemaVersion !== 1 || database.dataVersion !== version.version) {
  errors.push("visa_requirements.json: schema/dataVersion mismatch");
}
if (
  version.passportCount !== EXPECTED_PASSPORTS ||
  version.destinationCount !== EXPECTED_DESTINATIONS ||
  version.rulesPerPassport !== EXPECTED_DESTINATIONS - 1
) {
  errors.push("version.json: matrix contract mismatch");
}
if (version.updated !== database.updated) {
  errors.push("version.json and visa_requirements.json dates do not match");
}

const qualityReport = auditDatabaseQuality({
  database,
  destinationManifest,
  officialRulePolicies,
  specialMobilityWatches,
  territoryDerivations,
  baseDir: new URL(".", import.meta.url).pathname,
  today,
});
for (const warning of qualityReport.warnings) {
  console.warn(`WARNING: ${warning}`);
}
errors.push(...qualityReport.errors);

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
