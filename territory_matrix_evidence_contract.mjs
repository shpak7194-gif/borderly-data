import crypto from "node:crypto";
import {
  auditOfficialTerritoryPolicies,
  buildTerritoryPolicyContext,
  expectedOfficialTerritoryRule,
} from "./territory_policy_contract.mjs";
import {
  evidenceFreshnessState,
  evidenceQuoteSha256,
  normalizeEvidenceText,
} from "./official_evidence_contract.mjs";

export const TERRITORY_MATRIX_EVIDENCE_SCHEMA_VERSION = 1;

const SOURCE_TIER_BY_PUBLISHER_TYPE = new Map([
  ["destination-immigration", 1],
  ["destination-foreign-ministry", 1],
  ["destination-government", 1],
  ["destination-legislation", 1],
]);
const COVERAGE_MODES = new Set([
  "complete-official-table",
  "complete-requirement-list-with-default-complement",
  "complete-exemption-list-with-default-complement",
  "universal-rule-with-explicit-exceptions",
  "parent-regime-with-official-exceptions",
  "statutory-annex-with-default-obligation",
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function compactRule(rule) {
  return {
    status: rule?.status,
    ...(Number.isInteger(rule?.days) ? { days: rule.days } : {}),
  };
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validIsoDate(value) {
  if (!DATE_PATTERN.test(String(value ?? ""))) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function referencedPassportGroupIds(policy) {
  return [
    ...new Set(
      (policy?.rules ?? []).flatMap((rule) => rule.passportGroupIds ?? [])
    ),
  ].sort();
}

function directPassportIso2s(policy) {
  return [
    ...new Set((policy?.rules ?? []).flatMap((rule) => rule.passportIso2s ?? [])),
  ].sort();
}

function cleanParentPolicy(parentPolicy) {
  if (!parentPolicy) return null;
  return {
    destinationIso2: parentPolicy.destinationIso2,
    selfFallback: parentPolicy.selfFallback ?? null,
    unmappedStatus: parentPolicy.unmappedStatus ?? null,
    statusMap: parentPolicy.statusMap ?? null,
  };
}

export function territoryPolicyEvidenceSnapshot({ policy, context }) {
  const groupIds = referencedPassportGroupIds(policy);
  return {
    id: policy.id,
    destinationIso2: policy.destinationIso2,
    source: policy.source,
    sourceUrl: policy.sourceUrl,
    evidenceSources: policy.evidenceSources ?? [],
    verifiedAt: policy.verifiedAt,
    defaultRule: policy.defaultRule ?? null,
    parentPolicy: cleanParentPolicy(policy.parentPolicy),
    rules: policy.rules ?? [],
    conditionsByPassportIso2: policy.conditionsByPassportIso2 ?? {},
    note: policy.note ?? null,
    passportGroups: groupIds.map((groupId) => {
      const group = context.groupDefinitionById.get(groupId);
      return {
        id: group.id,
        passportIso2s: [...(group.passportIso2s ?? [])].sort(),
        conditionsByPassportIso2: group.conditionsByPassportIso2 ?? {},
      };
    }),
  };
}

export function territoryPolicyEvidenceSha256({ policy, context }) {
  return digest(territoryPolicyEvidenceSnapshot({ policy, context }));
}

export function territoryMatrixEvidenceRows({
  policy,
  database,
  destinationManifest,
  context,
}) {
  const numericToIso2 = Object.fromEntries(
    destinationManifest.destinations.map((destination) => [
      String(destination.numeric),
      destination.iso2,
    ])
  );
  return Object.entries(database.passports ?? {})
    .filter(([passportNumeric]) =>
      String(passportNumeric) !== String(policy.destinationNumeric)
    )
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([passportNumeric, row]) => {
      const expected = expectedOfficialTerritoryRule({
        policy,
        passportId: String(passportNumeric),
        passportIso2: numericToIso2[String(passportNumeric)],
        row,
        context,
      });
      return {
        passportNumeric: String(passportNumeric),
        passportIso2: numericToIso2[String(passportNumeric)],
        rule: compactRule(expected),
      };
    });
}

export function territoryMatrixEvidenceSha256(args) {
  return digest(territoryMatrixEvidenceRows(args));
}

function allowedPolicySources(policy) {
  return [
    { authority: policy.source, url: policy.sourceUrl },
    ...(policy.sourceUrls ?? []).map((url) => ({
      authority: policy.source,
      url,
    })),
    ...(policy.evidenceSources ?? []),
  ];
}

function validateSourceEvidence({
  item,
  prefix,
  policy,
  freshnessPolicy,
  today,
  errors,
  warnings,
}) {
  const source = item?.source ?? {};
  const expectedTier = SOURCE_TIER_BY_PUBLISHER_TYPE.get(source.publisherType);
  if (!expectedTier || source.tier !== expectedTier) {
    errors.push(`${prefix}: source tier does not match publisherType`);
  }
  if (!source.authority || !String(source.url ?? "").startsWith("https://")) {
    errors.push(`${prefix}: incomplete official source`);
  }
  if (!/^[a-z]{2,3}$/i.test(String(source.language ?? ""))) {
    errors.push(`${prefix}: invalid source language`);
  }
  if (
    !["manual-review", "structured-official-page"].includes(
      source.collectionMethod
    )
  ) {
    errors.push(`${prefix}: unsupported collectionMethod`);
  }
  if (!validIsoDate(source.checkedAt)) {
    errors.push(`${prefix}: checkedAt must use a valid YYYY-MM-DD date`);
  }
  if (source.contentDate && !validIsoDate(source.contentDate)) {
    errors.push(`${prefix}: contentDate must use a valid YYYY-MM-DD date`);
  }
  if (
    validIsoDate(source.checkedAt) &&
    validIsoDate(policy.verifiedAt) &&
    source.checkedAt < policy.verifiedAt
  ) {
    errors.push(`${prefix}: source was checked before the matrix policy`);
  }

  const allowedSources = allowedPolicySources(policy);
  if (
    !allowedSources.some(
      (candidate) =>
        candidate.authority === source.authority && candidate.url === source.url
    )
  ) {
    errors.push(`${prefix}: source is not allowlisted by ${policy.id}`);
  }

  const fragments = item?.quoteFragments ?? [];
  if (
    !Array.isArray(fragments) ||
    fragments.length === 0 ||
    fragments.some(
      (fragment) =>
        typeof fragment !== "string" ||
        fragment.trim().length < 3 ||
        fragment.length > 1_200
    )
  ) {
    errors.push(`${prefix}: quoteFragments must contain short exact excerpts`);
  }
  const normalizedQuote = normalizeEvidenceText(fragments.join("\n"));
  if (normalizedQuote.length < 10) {
    errors.push(`${prefix}: official quote is too short`);
  }
  if (item?.quoteSha256 !== evidenceQuoteSha256(fragments)) {
    errors.push(`${prefix}: quoteSha256 does not match exact excerpts`);
  }

  const termGroups = item?.requiredEvidenceTermGroups ?? [];
  if (
    !Array.isArray(termGroups) ||
    termGroups.length < 2 ||
    termGroups.some((group) => !Array.isArray(group) || group.length === 0)
  ) {
    errors.push(`${prefix}: at least two evidence term groups are required`);
  } else {
    for (const group of termGroups) {
      if (
        !group.some((term) =>
          normalizedQuote.includes(normalizeEvidenceText(term))
        )
      ) {
        errors.push(
          `${prefix}: quote is missing evidence alternatives ${group.join(" | ")}`
        );
      }
    }
  }

  let freshness = { state: "invalid-date", ageDays: null };
  try {
    freshness = evidenceFreshnessState({
      checkedAt: source.checkedAt,
      today,
      freshForDays: freshnessPolicy.freshForDays,
      staleAfterDays: freshnessPolicy.staleAfterDays,
    });
    if (freshness.state === "future-date") {
      errors.push(`${prefix}: checkedAt is in the future`);
    } else if (freshness.state === "stale") {
      warnings.push(`${prefix}: official evidence is ${freshness.ageDays} days old`);
    }
  } catch (error) {
    errors.push(`${prefix}: ${error.message}`);
  }

  return { source, freshness };
}

export function validateTerritoryMatrixEvidenceRegistry({
  registry,
  policyDatabase,
  database,
  destinationManifest,
  today,
}) {
  const errors = [];
  const warnings = [];
  const coveredPairs = new Set();
  const evaluatedEntries = [];
  let context;
  try {
    context = buildTerritoryPolicyContext({
      policyDatabase,
      destinationManifest,
    });
  } catch (error) {
    return {
      ok: false,
      errors: [error.message],
      warnings,
      entries: [],
      coveredPairs,
      missingPolicyIds: [],
    };
  }

  if (registry?.schemaVersion !== TERRITORY_MATRIX_EVIDENCE_SCHEMA_VERSION) {
    errors.push("territory_matrix_evidence.json: unsupported schemaVersion");
  }
  if (
    registry?.verificationPolicy !==
    "official-source-reviewed-complete-territory-matrix"
  ) {
    errors.push("territory_matrix_evidence.json: verificationPolicy is unsafe");
  }
  const freshnessPolicy = registry?.freshnessPolicy ?? {};
  if (
    !Number.isInteger(freshnessPolicy.freshForDays) ||
    !Number.isInteger(freshnessPolicy.staleAfterDays) ||
    freshnessPolicy.freshForDays < 1 ||
    freshnessPolicy.staleAfterDays <= freshnessPolicy.freshForDays
  ) {
    errors.push("territory_matrix_evidence.json: invalid freshness policy");
  }

  const audit = auditOfficialTerritoryPolicies({
    database,
    destinationManifest,
    policyDatabase,
  });
  errors.push(...audit.errors);

  const entries = registry?.entries ?? [];
  if (!Array.isArray(entries)) {
    errors.push("territory_matrix_evidence.json: entries must be an array");
    return {
      ok: false,
      errors,
      warnings,
      entries: [],
      coveredPairs,
      missingPolicyIds: [...context.policyById.keys()],
    };
  }
  const sharedSourceEvidence = registry?.sourceEvidence ?? [];
  const sourceEvidenceById = new Map();
  if (!Array.isArray(sharedSourceEvidence)) {
    errors.push("territory_matrix_evidence.json: sourceEvidence must be an array");
  } else {
    for (const item of sharedSourceEvidence) {
      if (!/^[a-z0-9][a-z0-9-]+$/.test(String(item?.id ?? ""))) {
        errors.push(`${item?.id ?? "source-evidence-without-id"}: invalid source evidence id`);
      } else if (sourceEvidenceById.has(item.id)) {
        errors.push(`${item.id}: duplicate source evidence id`);
      }
      sourceEvidenceById.set(item?.id, item);
    }
  }
  const seenIds = new Set();
  const seenPolicyIds = new Set();
  const referencedSourceEvidenceIds = new Set();

  for (const entry of entries) {
    const prefix = entry?.id ?? "territory-evidence-without-id";
    if (!/^[a-z0-9][a-z0-9-]+$/.test(String(entry?.id ?? ""))) {
      errors.push(`${prefix}: invalid evidence id`);
    } else if (seenIds.has(entry.id)) {
      errors.push(`${prefix}: duplicate evidence id`);
    }
    seenIds.add(entry?.id);
    if (entry?.verificationStatus !== "verified") {
      errors.push(`${prefix}: only verified matrix evidence belongs here`);
    }
    if (!COVERAGE_MODES.has(entry?.coverageMode)) {
      errors.push(`${prefix}: unsupported coverageMode ${entry?.coverageMode}`);
    }

    const policy = context.policyById.get(entry?.policyId);
    if (!policy) {
      errors.push(`${prefix}: unknown policyId ${entry?.policyId}`);
      continue;
    }
    if (seenPolicyIds.has(policy.id)) {
      errors.push(`${prefix}: policy ${policy.id} has overlapping evidence`);
    }
    seenPolicyIds.add(policy.id);
    if (entry?.destinationIso2 !== policy.destinationIso2) {
      errors.push(`${prefix}: destinationIso2 does not match ${policy.id}`);
    }
    if (String(entry?.destinationNumeric ?? "") !== String(policy.destinationNumeric)) {
      errors.push(`${prefix}: destinationNumeric does not match ${policy.id}`);
    }

    const manualReview = entry?.manualReview ?? {};
    if (
      manualReview.scope !== "ordinary-passport-short-stay-tourism" ||
      manualReview.completeMatrixConfirmed !== true ||
      manualReview.allReferencedGroupsCompared !== true ||
      manualReview.allDirectOverridesCompared !== true ||
      manualReview.defaultOrParentSemanticsConfirmed !== true
    ) {
      errors.push(`${prefix}: incomplete manual matrix review declaration`);
    }
    if (!validIsoDate(manualReview.reviewedAt)) {
      errors.push(`${prefix}: manualReview.reviewedAt is invalid`);
    } else if (manualReview.reviewedAt < policy.verifiedAt) {
      errors.push(`${prefix}: manual review predates the policy matrix`);
    }
    if (String(manualReview.coverageReason ?? "").trim().length < 40) {
      errors.push(`${prefix}: a concrete coverageReason is required`);
    }

    const expectedGroupIds = referencedPassportGroupIds(policy);
    const expectedDirectIso2s = directPassportIso2s(policy);
    if (!sameArray(entry?.reviewedPassportGroupIds, expectedGroupIds)) {
      errors.push(`${prefix}: reviewed passport groups do not match the policy`);
    }
    if (!sameArray(entry?.reviewedDirectPassportIso2s, expectedDirectIso2s)) {
      errors.push(`${prefix}: reviewed direct passports do not match the policy`);
    }

    const expectedPolicySha256 = territoryPolicyEvidenceSha256({
      policy,
      context,
    });
    if (entry?.reviewedPolicySha256 !== expectedPolicySha256) {
      errors.push(`${prefix}: reviewedPolicySha256 does not match the policy`);
    }
    const rows = territoryMatrixEvidenceRows({
      policy,
      database,
      destinationManifest,
      context,
    });
    const expectedMatrixSha256 = digest(rows);
    if (entry?.reviewedMatrixSha256 !== expectedMatrixSha256) {
      errors.push(`${prefix}: reviewedMatrixSha256 does not match the matrix`);
    }
    if (entry?.coveredRuleCount !== rows.length) {
      errors.push(`${prefix}: coveredRuleCount must equal ${rows.length}`);
    }

    const sourceEvidenceIds = entry?.sourceEvidenceIds ?? [];
    if (!Array.isArray(sourceEvidenceIds) || sourceEvidenceIds.length === 0) {
      errors.push(`${prefix}: sourceEvidenceIds must not be empty`);
    }
    const seenSources = new Set();
    const evaluatedSources = [];
    for (let index = 0; index < sourceEvidenceIds.length; index += 1) {
      const sourceEvidenceId = sourceEvidenceIds[index];
      const item = sourceEvidenceById.get(sourceEvidenceId);
      const sourcePrefix = `${prefix}.sourceEvidenceIds[${index}]`;
      if (!item) {
        errors.push(`${sourcePrefix}: unknown source evidence ${sourceEvidenceId}`);
        continue;
      }
      referencedSourceEvidenceIds.add(sourceEvidenceId);
      const sourceKey = `${item?.source?.authority ?? ""}|${item?.source?.url ?? ""}`;
      if (seenSources.has(sourceKey)) {
        errors.push(`${sourcePrefix}: duplicate source`);
      }
      seenSources.add(sourceKey);
      evaluatedSources.push(
        validateSourceEvidence({
          item,
          prefix: sourcePrefix,
          policy,
          freshnessPolicy,
          today,
          errors,
          warnings,
        })
      );
    }
    const primarySourceKey = `${policy.source}|${policy.sourceUrl}`;
    if (!seenSources.has(primarySourceKey)) {
      errors.push(`${prefix}: primary policy source evidence is missing`);
    }

    for (const row of rows) {
      const pair = `${row.passportNumeric}:${policy.destinationNumeric}`;
      if (coveredPairs.has(pair)) {
        errors.push(`${prefix}: overlapping matrix evidence for ${pair}`);
      }
      coveredPairs.add(pair);
      const published = database.passports?.[row.passportNumeric]?.[
        String(policy.destinationNumeric)
      ];
      if (published?.sourceType !== "official") {
        errors.push(`${prefix}: ${pair} is not official provenance`);
      }
      const expectedTerritoryPolicyId =
        `territory-${policy.destinationIso2.toLowerCase()}-official-${policy.id}`;
      if (published?.territoryPolicyId !== expectedTerritoryPolicyId) {
        errors.push(`${prefix}: ${pair} is not protected by ${policy.id}`);
      }
      if (
        published?.status !== row.rule.status ||
        (published?.days ?? null) !== (row.rule.days ?? null)
      ) {
        errors.push(`${prefix}: published matrix mismatch at ${pair}`);
      }
    }

    evaluatedEntries.push({
      id: entry.id,
      policyId: policy.id,
      destinationIso2: policy.destinationIso2,
      destinationNumeric: String(policy.destinationNumeric),
      coverageMode: entry.coverageMode,
      coveredRuleCount: rows.length,
      reviewedAt: manualReview.reviewedAt,
      sources: evaluatedSources,
    });
  }

  const missingPolicyIds = [...context.policyById.keys()].filter(
    (policyId) => !seenPolicyIds.has(policyId)
  );
  for (const sourceEvidenceId of sourceEvidenceById.keys()) {
    if (!referencedSourceEvidenceIds.has(sourceEvidenceId)) {
      errors.push(`${sourceEvidenceId}: source evidence is not referenced`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    entries: evaluatedEntries,
    coveredPairs,
    missingPolicyIds,
    policyCount: context.policyById.size,
    matrixRuleCount: audit.checkedRules,
  };
}
