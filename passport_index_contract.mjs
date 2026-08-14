import crypto from "node:crypto";

export const PASSPORT_INDEX_SOURCE_ID = "passport-index-data";
export const PASSPORT_INDEX_SOURCE_FILE = "passport_index_source.json";
export const PASSPORT_INDEX_SOURCE_REPOSITORY =
  "https://github.com/imorte/passport-index-data";
export const PASSPORT_INDEX_SOURCE_URL =
  "https://raw.githubusercontent.com/imorte/passport-index-data/refs/heads/main/passport-index.json";

export const PASSPORT_INDEX_RAW_STATUSES = new Set([
  "visa free",
  "eta",
  "visa on arrival",
  "e-visa",
  "visa required",
  "no admission",
]);

export function normalizePassportIndexRule(rule) {
  if (!rule || typeof rule !== "object") {
    throw new Error("Passport Index rule must be an object");
  }
  if (!PASSPORT_INDEX_RAW_STATUSES.has(rule.status)) {
    throw new Error(`Unsupported Passport Index status: ${rule.status}`);
  }

  const result = {
    status: rule.status === "no admission" ? "entry restricted" : rule.status,
  };
  if (rule.days !== undefined) {
    if (!Number.isInteger(rule.days) || rule.days <= 0 || rule.days > 3660) {
      throw new Error(`Invalid Passport Index stay length: ${rule.days}`);
    }
    result.days = rule.days;
  }
  return result;
}

export function canonicalPassportIndexText(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Passport Index source must be an object");
  }

  const canonical = {};
  for (const passportIso2 of Object.keys(source).sort()) {
    const sourceRow = source[passportIso2];
    if (!sourceRow || typeof sourceRow !== "object" || Array.isArray(sourceRow)) {
      throw new Error(`Passport Index row ${passportIso2} must be an object`);
    }
    canonical[passportIso2] = {};
    for (const destinationIso2 of Object.keys(sourceRow).sort()) {
      const rule = sourceRow[destinationIso2];
      normalizePassportIndexRule(rule);
      canonical[passportIso2][destinationIso2] = {
        status: rule.status,
        ...(rule.days !== undefined ? { days: rule.days } : {}),
      };
    }
  }
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export function buildPassportIndexSnapshotMetadata({
  text,
  updated,
  source,
  file = PASSPORT_INDEX_SOURCE_FILE,
}) {
  let ruleCount = 0;
  for (const row of Object.values(source ?? {})) {
    ruleCount += Object.keys(row ?? {}).length;
  }
  return {
    schemaVersion: 1,
    sourceId: PASSPORT_INDEX_SOURCE_ID,
    file,
    sourceUrl: PASSPORT_INDEX_SOURCE_URL,
    sourceRepository: PASSPORT_INDEX_SOURCE_REPOSITORY,
    sha256: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
    bytes: Buffer.byteLength(text, "utf8"),
    updated,
    passportCount: Object.keys(source ?? {}).length,
    ruleCount,
  };
}

export function isProtectedOfficialRule(rule) {
  return Boolean(
    rule?.sourceType === "official" &&
      rule?.source &&
      String(rule?.sourceUrl ?? "").startsWith("https://") &&
      rule?.updated
  );
}

function sameSemanticRule(actual, expected) {
  return Boolean(
    actual &&
      actual.status === expected.status &&
      (actual.days ?? null) === (expected.days ?? null)
  );
}

export function auditPassportIndexExactness({
  database,
  source,
  destinationManifest,
}) {
  const errors = [];
  const coreDestinations = (destinationManifest?.destinations ?? []).filter(
    (destination) => destination.sourceKind === "passport-index-core"
  );
  const coreIso2 = new Set(coreDestinations.map((destination) => destination.iso2));
  const numericToIso2 = new Map(
    coreDestinations.map((destination) => [
      String(destination.numeric),
      destination.iso2,
    ])
  );
  const iso2ToNumeric = new Map(
    coreDestinations.map((destination) => [
      destination.iso2,
      String(destination.numeric),
    ])
  );
  const databasePassportIds = Object.keys(database?.passports ?? {});

  if (coreDestinations.length !== 199) {
    errors.push(`Expected 199 Passport Index destinations, found ${coreDestinations.length}`);
  }
  if (Object.keys(source ?? {}).length !== coreDestinations.length) {
    errors.push(
      `Passport Index snapshot has ${Object.keys(source ?? {}).length} passports; ` +
        `expected ${coreDestinations.length}`
    );
  }

  for (const sourcePassport of Object.keys(source ?? {})) {
    if (!coreIso2.has(sourcePassport)) {
      errors.push(`Passport Index snapshot contains unsupported passport ${sourcePassport}`);
    }
  }

  let exactRules = 0;
  let protectedOfficialRules = 0;
  let checkedSourceRules = 0;
  const statusCounts = {};

  for (const passportId of databasePassportIds) {
    const passportIso2 = numericToIso2.get(String(passportId));
    if (!passportIso2) {
      errors.push(`Database passport ${passportId} is absent from Passport Index core`);
      continue;
    }
    const sourceRow = source?.[passportIso2];
    if (!sourceRow) {
      errors.push(`Passport Index snapshot is missing passport ${passportIso2}`);
      continue;
    }

    const expectedDestinationCodes = new Set(coreIso2);
    expectedDestinationCodes.delete(passportIso2);
    const actualSourceCodes = new Set(Object.keys(sourceRow));
    for (const destinationIso2 of actualSourceCodes) {
      if (!expectedDestinationCodes.has(destinationIso2)) {
        errors.push(
          `${passportIso2}: Passport Index snapshot has unexpected destination ${destinationIso2}`
        );
      }
    }
    for (const destinationIso2 of expectedDestinationCodes) {
      if (!actualSourceCodes.has(destinationIso2)) {
        errors.push(
          `${passportIso2}: Passport Index snapshot is missing destination ${destinationIso2}`
        );
        continue;
      }
      checkedSourceRules += 1;
      let expected;
      try {
        expected = normalizePassportIndexRule(sourceRow[destinationIso2]);
      } catch (error) {
        errors.push(`${passportIso2}->${destinationIso2}: ${error.message}`);
        continue;
      }
      statusCounts[expected.status] = (statusCounts[expected.status] ?? 0) + 1;

      const destinationId = iso2ToNumeric.get(destinationIso2);
      const actual = database.passports?.[passportId]?.[destinationId];
      if (isProtectedOfficialRule(actual)) {
        protectedOfficialRules += 1;
        continue;
      }
      if (!sameSemanticRule(actual, expected)) {
        errors.push(
          `${passportIso2}->${destinationIso2}: expected ${expected.status}` +
            `${expected.days ? `/${expected.days}` : ""} from Passport Index, found ` +
            `${actual?.status ?? "missing"}${actual?.days ? `/${actual.days}` : ""}`
        );
        continue;
      }
      exactRules += 1;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    metrics: {
      passports: databasePassportIds.length,
      coreDestinations: coreDestinations.length,
      checkedSourceRules,
      exactRules,
      protectedOfficialRules,
      statusCounts,
    },
  };
}
