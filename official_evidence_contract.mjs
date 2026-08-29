import crypto from "node:crypto";

export const OFFICIAL_EVIDENCE_SCHEMA_VERSION = 1;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_TIER_BY_PUBLISHER_TYPE = new Map([
  ["destination-immigration", 1],
  ["destination-foreign-ministry", 1],
  ["destination-embassy-or-consulate", 2],
  ["passport-country-advisory", 3],
]);
const MANUAL_OVERRIDE_STATUSES = new Set([
  "entry restricted",
  "special permit",
  "mixed requirements",
]);

export function normalizeEvidenceText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function evidenceQuoteSha256(fragments) {
  const normalized = normalizeEvidenceText((fragments ?? []).join("\n"));
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function parseIsoDate(value, label) {
  if (!DATE_PATTERN.test(String(value ?? ""))) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} is invalid`);
  if (new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is invalid`);
  }
  return timestamp;
}

export function evidenceFreshnessState({
  checkedAt,
  today,
  freshForDays = 30,
  staleAfterDays = 90,
}) {
  if (!Number.isInteger(freshForDays) || freshForDays < 1) {
    throw new Error("freshForDays must be a positive integer");
  }
  if (!Number.isInteger(staleAfterDays) || staleAfterDays <= freshForDays) {
    throw new Error("staleAfterDays must be greater than freshForDays");
  }
  const checkedTimestamp = parseIsoDate(checkedAt, "checkedAt");
  const todayTimestamp = parseIsoDate(today, "today");
  const ageDays = Math.floor((todayTimestamp - checkedTimestamp) / 86_400_000);
  if (ageDays < 0) return { state: "future-date", ageDays };
  if (ageDays <= freshForDays) return { state: "fresh", ageDays };
  if (ageDays <= staleAfterDays) return { state: "aging", ageDays };
  return { state: "stale", ageDays };
}

export function classifyTravelerAction(classification) {
  const value = classification ?? {};
  if (value.manualOverrideStatus) {
    if (
      value.manualReviewRequired !== true ||
      !MANUAL_OVERRIDE_STATUSES.has(value.manualOverrideStatus)
    ) {
      throw new Error("Manual classification override is not safety-approved");
    }
    return value.manualOverrideStatus;
  }

  if (value.freedomOfMovement === true) {
    if (
      value.preTravelAction !== "none" ||
      value.issuedAt !== "none" ||
      value.inPersonStepRequired === true
    ) {
      throw new Error("Freedom of movement cannot require a visa action");
    }
    return "freedom";
  }

  if (value.inPersonStepRequired === true) return "visa required";

  if (value.preTravelAction === "electronic-authorization") {
    if (value.issuedAt !== "before-travel") {
      throw new Error("eTA must be issued before travel");
    }
    return "eta";
  }
  if (value.preTravelAction === "electronic-visa") {
    if (value.issuedAt !== "before-travel") {
      throw new Error("eVisa must be issued before travel");
    }
    return "e-visa";
  }
  if (value.preTravelAction === "special-permit") {
    return "special permit";
  }
  if (value.preTravelAction === "in-person-visa") {
    throw new Error("In-person visa action must set inPersonStepRequired=true");
  }
  if (value.preTravelAction !== "none") {
    throw new Error(`Unknown pre-travel action: ${value.preTravelAction}`);
  }
  if (value.issuedAt === "border") return "visa on arrival";
  if (value.issuedAt === "none") return "visa free";
  throw new Error(`Unsupported issuance point: ${value.issuedAt}`);
}

function stableRule(rule) {
  return {
    status: rule?.status,
    ...(rule?.days !== undefined ? { days: rule.days } : {}),
  };
}

function sameRule(left, right) {
  return (
    left?.status === right?.status &&
    (left?.days ?? null) === (right?.days ?? null)
  );
}

function activeOnDate(value, today) {
  return (
    (!value?.validFrom || today >= value.validFrom) &&
    (!value?.validUntil || today <= value.validUntil)
  );
}

export function validateOfficialEvidenceRegistry({
  registry,
  officialRulePolicies,
  database,
  destinationManifest,
  allowedStatuses,
  today,
}) {
  const errors = [];
  const warnings = [];
  const entries = registry?.entries ?? [];
  const policy = registry?.freshnessPolicy ?? {};
  const destinationIds = new Set(
    (destinationManifest?.destinations ?? []).map((item) => String(item.numeric))
  );
  const passportIds = new Set(Object.keys(database?.passports ?? {}));
  const policyById = new Map(
    (officialRulePolicies?.policies ?? []).map((item) => [item.id, item])
  );
  const evidenceIds = new Set();
  const coveredPairs = new Set();
  const evaluatedEntries = [];

  if (registry?.schemaVersion !== OFFICIAL_EVIDENCE_SCHEMA_VERSION) {
    errors.push("official_rule_evidence.json: unsupported schemaVersion");
  }
  if (registry?.verificationPolicy !== "official-url-exact-quote-per-rule") {
    errors.push("official_rule_evidence.json: verificationPolicy is unsafe");
  }
  if (!Array.isArray(entries)) {
    errors.push("official_rule_evidence.json: entries must be an array");
    return { ok: false, errors, warnings, entries: [], coveredPairs };
  }
  if (
    !Number.isInteger(policy.freshForDays) ||
    !Number.isInteger(policy.staleAfterDays) ||
    policy.freshForDays < 1 ||
    policy.staleAfterDays <= policy.freshForDays
  ) {
    errors.push("official_rule_evidence.json: invalid freshness policy");
  }

  for (const entry of entries) {
    const prefix = entry?.id ?? "evidence-without-id";
    if (!/^[a-z0-9][a-z0-9-]+$/.test(String(entry?.id ?? ""))) {
      errors.push(`${prefix}: invalid evidence id`);
    } else if (evidenceIds.has(entry.id)) {
      errors.push(`${prefix}: duplicate evidence id`);
    }
    evidenceIds.add(entry?.id);

    if (entry?.verificationStatus !== "verified") {
      errors.push(`${prefix}: only verified evidence belongs in this registry`);
    }
    const policyEntry = policyById.get(entry?.policyId);
    if (!policyEntry) errors.push(`${prefix}: unknown policyId ${entry?.policyId}`);

    const destinationId = String(entry?.destinationNumeric ?? "");
    const entryPassportIds = (entry?.passportNumerics ?? []).map(String);
    if (!destinationIds.has(destinationId)) {
      errors.push(`${prefix}: unsupported destination ${destinationId}`);
    }
    if (entryPassportIds.length === 0) {
      errors.push(`${prefix}: passportNumerics must not be empty`);
    }
    if (new Set(entryPassportIds).size !== entryPassportIds.length) {
      errors.push(`${prefix}: passportNumerics contains duplicates`);
    }
    for (const passportId of entryPassportIds) {
      if (!passportIds.has(passportId) || passportId === destinationId) {
        errors.push(`${prefix}: invalid pair ${passportId}:${destinationId}`);
      }
    }

    const source = entry?.source ?? {};
    const expectedTier = SOURCE_TIER_BY_PUBLISHER_TYPE.get(source.publisherType);
    if (!expectedTier || source.tier !== expectedTier) {
      errors.push(`${prefix}: source tier does not match publisherType`);
    }
    if (expectedTier === 3) {
      errors.push(
        `${prefix}: passport-country advice may cross-check a rule but cannot be its sole verified evidence`
      );
    }
    if (!source.authority || !String(source.url ?? "").startsWith("https://")) {
      errors.push(`${prefix}: incomplete official source`);
    }
    if (!/^[a-z]{2,3}$/i.test(String(source.language ?? ""))) {
      errors.push(`${prefix}: invalid source language`);
    }
    if (
      !["manual-review", "official-api", "structured-official-page"].includes(
        source.collectionMethod
      )
    ) {
      errors.push(`${prefix}: unsupported collectionMethod`);
    }
    try {
      parseIsoDate(source.checkedAt, `${prefix}.source.checkedAt`);
      if (source.contentDate) {
        parseIsoDate(source.contentDate, `${prefix}.source.contentDate`);
      }
    } catch (error) {
      errors.push(error.message);
    }

    const fragments = entry?.quoteFragments ?? [];
    if (
      !Array.isArray(fragments) ||
      fragments.length === 0 ||
      fragments.some((fragment) =>
        typeof fragment !== "string" || fragment.trim().length < 3 || fragment.length > 500
      )
    ) {
      errors.push(`${prefix}: quoteFragments must contain short exact excerpts`);
    }
    const normalizedQuote = normalizeEvidenceText(fragments.join("\n"));
    if (normalizedQuote.length < 10) {
      errors.push(`${prefix}: official quote is too short`);
    }
    const expectedHash = evidenceQuoteSha256(fragments);
    if (entry?.quoteSha256 !== expectedHash) {
      errors.push(`${prefix}: quoteSha256 does not match exact excerpts`);
    }

    const termGroups = entry?.requiredEvidenceTermGroups ?? [];
    if (
      !Array.isArray(termGroups) ||
      termGroups.length < 2 ||
      termGroups.some((group) => !Array.isArray(group) || group.length === 0)
    ) {
      errors.push(`${prefix}: at least two evidence term groups are required`);
    } else {
      for (const group of termGroups) {
        if (!group.some((term) => normalizedQuote.includes(normalizeEvidenceText(term)))) {
          errors.push(`${prefix}: quote is missing evidence alternatives ${group.join(" | ")}`);
        }
      }
    }

    let classifiedStatus = null;
    const classification = entry?.classification ?? {};
    if (
      typeof classification.freedomOfMovement !== "boolean" ||
      typeof classification.inPersonStepRequired !== "boolean" ||
      typeof classification.preTravelAction !== "string" ||
      typeof classification.issuedAt !== "string"
    ) {
      errors.push(`${prefix}: traveler-action classification fields are incomplete`);
    }
    try {
      classifiedStatus = classifyTravelerAction(classification);
    } catch (error) {
      errors.push(`${prefix}: ${error.message}`);
    }
    if (!allowedStatuses.has(entry?.rule?.status)) {
      errors.push(`${prefix}: unsupported rule status ${entry?.rule?.status}`);
    }
    if (classifiedStatus && classifiedStatus !== entry?.rule?.status) {
      errors.push(
        `${prefix}: traveler-action classification is ${classifiedStatus}, ` +
          `not ${entry?.rule?.status}`
      );
    }
    if (
      entry?.rule?.days !== undefined &&
      (!Number.isInteger(entry.rule.days) || entry.rule.days <= 0 || entry.rule.days > 3660)
    ) {
      errors.push(`${prefix}: invalid stay length`);
    }
    if (
      Number.isInteger(entry?.rule?.days) &&
      !normalizedQuote.includes(String(entry.rule.days))
    ) {
      errors.push(`${prefix}: official quote does not contain the published stay length`);
    }
    if (String(classification.rationale ?? "").trim().length < 20) {
      errors.push(`${prefix}: classification rationale is required`);
    }

    if (policyEntry) {
      const allowedSourcePairs = [
        {
          authority: policyEntry.source,
          url: policyEntry.sourceUrl,
        },
        ...(policyEntry.sourceUrls ?? []).map((url) => ({
          authority: policyEntry.source,
          url,
        })),
        ...(policyEntry.evidenceSources ?? []),
      ];
      if (String(policyEntry.destinationNumeric) !== destinationId) {
        errors.push(`${prefix}: destination does not match ${policyEntry.id}`);
      }
      if (!sameRule(entry.rule, policyEntry.rule)) {
        errors.push(`${prefix}: rule does not match ${policyEntry.id}`);
      }
      if (
        !allowedSourcePairs.some(
          (candidate) =>
            candidate.authority === source.authority && candidate.url === source.url
        )
      ) {
        errors.push(`${prefix}: source does not match ${policyEntry.id}`);
      }
      const allowedPassports = new Set(policyEntry.passportNumerics.map(String));
      for (const passportId of entryPassportIds) {
        if (!allowedPassports.has(passportId)) {
          errors.push(`${prefix}: passport ${passportId} is outside ${policyEntry.id}`);
        }
      }
      for (const field of ["validFrom", "validUntil"]) {
        if ((entry?.[field] ?? null) !== (policyEntry?.[field] ?? null)) {
          errors.push(`${prefix}: ${field} does not match ${policyEntry.id}`);
        }
      }
    }

    let freshness = { state: "invalid-date", ageDays: null };
    try {
      freshness = evidenceFreshnessState({
        checkedAt: source.checkedAt,
        today,
        freshForDays: policy.freshForDays,
        staleAfterDays: policy.staleAfterDays,
      });
      if (freshness.state === "future-date") {
        errors.push(`${prefix}: checkedAt is in the future`);
      } else if (freshness.state === "stale") {
        warnings.push(`${prefix}: official evidence is ${freshness.ageDays} days old`);
      }
    } catch (error) {
      errors.push(`${prefix}: ${error.message}`);
    }

    const isActive = activeOnDate(entry, today);
    for (const passportId of entryPassportIds) {
      const pair = `${passportId}:${destinationId}`;
      if (isActive) {
        if (coveredPairs.has(pair)) errors.push(`${prefix}: overlapping evidence for ${pair}`);
        coveredPairs.add(pair);
        const databaseRule = database?.passports?.[passportId]?.[destinationId];
        if (!sameRule(databaseRule, entry.rule)) {
          errors.push(`${prefix}: published rule mismatch at ${pair}`);
        }
        if (databaseRule?.officialPolicyId !== entry?.policyId) {
          errors.push(`${prefix}: ${pair} is not protected by ${entry?.policyId}`);
        }
      }
    }

    evaluatedEntries.push({
      id: entry?.id,
      policyId: entry?.policyId,
      destinationNumeric: destinationId,
      passportNumerics: entryPassportIds,
      rule: stableRule(entry?.rule),
      source,
      validFrom: entry?.validFrom ?? null,
      validUntil: entry?.validUntil ?? null,
      active: isActive,
      freshness,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    entries: evaluatedEntries,
    coveredPairs,
  };
}
