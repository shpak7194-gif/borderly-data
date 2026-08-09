import fs from "node:fs";

const database = JSON.parse(
  fs.readFileSync(new URL("./visa_requirements.json", import.meta.url), "utf8")
);
const version = JSON.parse(
  fs.readFileSync(new URL("./version.json", import.meta.url), "utf8")
);

const EXPECTED_PASSPORTS = 199;
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

if (passportIds.length !== EXPECTED_PASSPORTS) {
  errors.push(
    `Expected ${EXPECTED_PASSPORTS} passports, found ${passportIds.length}`
  );
}

for (const [passportId, rules] of Object.entries(passports)) {
  const entries = Object.entries(rules ?? {});
  if (entries.length < EXPECTED_PASSPORTS - 1) {
    errors.push(`${passportId}: only ${entries.length} destination rules`);
  }

  const peerDestinations = new Set(
    entries
      .map(([destinationId]) => destinationId)
      .filter((destinationId) => passportIdSet.has(destinationId))
  );
  const expectedPeerRules = EXPECTED_PASSPORTS - 1;
  const selfRuleAdjustment = peerDestinations.has(passportId) ? 1 : 0;
  if (peerDestinations.size - selfRuleAdjustment !== expectedPeerRules) {
    errors.push(
      `${passportId}: incomplete passport matrix ` +
        `(${peerDestinations.size - selfRuleAdjustment}/${expectedPeerRules})`
    );
  }

  for (const [destinationId, rule] of entries) {
    if (!passportIdSet.has(destinationId) && destinationId !== GREENLAND_ID) {
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
  throw new Error(`Visa data validation failed:\n${errors.slice(0, 80).join("\n")}`);
}

const greenlandRules = passportIds.filter(
  (passportId) => passports[passportId]?.[GREENLAND_ID]
).length;
console.log(
  `OK: ${passportIds.length} passports, ` +
    `${greenlandRules} Greenland rules, version ${version.version}`
);
