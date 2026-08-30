import fs from "node:fs";
import path from "node:path";

export const TERRITORY_OFFICIAL_POLICIES_FILE =
  "territory_official_policies.json";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compactRule(rule) {
  const out = { status: rule.status };
  if (Number.isInteger(rule.days) && rule.days > 0) out.days = rule.days;
  return out;
}

function joinNotes(...values) {
  const parts = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return [...new Set(parts)].join(" ");
}

export function loadTerritoryOfficialPolicies(baseDir = process.cwd()) {
  return readJson(path.resolve(baseDir, TERRITORY_OFFICIAL_POLICIES_FILE));
}

export function collectTerritoryPolicySources(policyDatabase) {
  const byUrl = new Map();
  for (const policy of policyDatabase?.policies ?? []) {
    const urls = [
      policy.sourceUrl,
      ...(policy.sourceUrls ?? []),
      ...(policy.evidenceSources ?? []).map((source) => source.url),
    ].filter(Boolean);
    for (const url of new Set(urls)) {
      const item = byUrl.get(url) ?? { url, policyIds: [] };
      if (!item.policyIds.includes(policy.id)) item.policyIds.push(policy.id);
      byUrl.set(url, item);
    }
  }
  return [...byUrl.values()].sort((left, right) =>
    left.url.localeCompare(right.url)
  );
}

export function buildTerritoryPolicyContext({
  policyDatabase,
  destinationManifest,
}) {
  if (policyDatabase?.schemaVersion !== 1) {
    throw new Error(
      `${TERRITORY_OFFICIAL_POLICIES_FILE}: unsupported schemaVersion`
    );
  }

  const destinationByIso2 = new Map(
    (destinationManifest.destinations ?? []).map((destination) => [
      destination.iso2,
      destination,
    ])
  );
  const destinationByNumeric = new Map(
    (destinationManifest.destinations ?? []).map((destination) => [
      String(destination.numeric),
      destination,
    ])
  );
  const passportIso2s = new Set(
    (destinationManifest.destinations ?? [])
      .filter((destination) => destination.sourceKind === "passport-index-core")
      .map((destination) => destination.iso2)
  );
  const groupById = new Map();
  const groupDefinitionById = new Map();
  for (const group of policyDatabase.passportGroups ?? []) {
    if (!group.id || groupById.has(group.id)) {
      throw new Error(`Duplicate or empty passport group id: ${group.id}`);
    }
    const values = new Set((group.passportIso2s ?? []).map(String));
    for (const iso2 of values) {
      if (!passportIso2s.has(iso2)) {
        throw new Error(`${group.id}: unsupported passport ISO2 ${iso2}`);
      }
    }
    groupById.set(group.id, values);
    groupDefinitionById.set(group.id, group);
  }

  const policyById = new Map();
  const policyByDestination = new Map();
  for (const policy of policyDatabase.policies ?? []) {
    if (!policy.id || policyById.has(policy.id)) {
      throw new Error(`Duplicate or empty official territory policy id: ${policy.id}`);
    }
    const destination = destinationByIso2.get(policy.destinationIso2);
    if (!destination || destination.sourceKind !== "territory-registry") {
      throw new Error(
        `${policy.id}: invalid territory destination ${policy.destinationIso2}`
      );
    }
    const destinationId = String(destination.numeric);
    if (policyByDestination.has(destinationId)) {
      throw new Error(
        `${policy.destinationIso2}: more than one official territory policy`
      );
    }
    if (!policy.source || !policy.sourceUrl || !policy.verifiedAt) {
      throw new Error(`${policy.id}: incomplete official source metadata`);
    }
    if (!String(policy.sourceUrl).startsWith("https://")) {
      throw new Error(`${policy.id}: official source URL must use HTTPS`);
    }
    if (!policy.defaultRule && !policy.parentPolicy) {
      throw new Error(`${policy.id}: defaultRule or parentPolicy is required`);
    }
    if (policy.parentPolicy) {
      const parent = destinationByIso2.get(policy.parentPolicy.destinationIso2);
      if (!parent) {
        throw new Error(
          `${policy.id}: invalid parent ${policy.parentPolicy.destinationIso2}`
        );
      }
      policy.parentPolicy.destinationNumeric = String(parent.numeric);
    }

    for (const rule of policy.rules ?? []) {
      for (const groupId of rule.passportGroupIds ?? []) {
        if (!groupById.has(groupId)) {
          throw new Error(`${policy.id}: unknown passport group ${groupId}`);
        }
      }
      for (const iso2 of rule.passportIso2s ?? []) {
        if (!passportIso2s.has(iso2)) {
          throw new Error(`${policy.id}: unsupported passport ISO2 ${iso2}`);
        }
      }
    }

    policy.destinationNumeric = destinationId;
    policyById.set(policy.id, policy);
    policyByDestination.set(destinationId, policy);
  }

  return {
    destinationByIso2,
    destinationByNumeric,
    passportIso2s,
    groupById,
    groupDefinitionById,
    policyById,
    policyByDestination,
  };
}

function ruleMatchesPassport(rule, passportIso2, context) {
  if ((rule.passportIso2s ?? []).includes(passportIso2)) return true;
  return (rule.passportGroupIds ?? []).some((groupId) =>
    context.groupById.get(groupId)?.has(passportIso2)
  );
}

function parentDerivedRule({ policy, passportId, row, context }) {
  const parent = policy.parentPolicy;
  if (!parent) return null;
  const parentId = String(parent.destinationNumeric);
  const sourceRule =
    passportId === parentId
      ? parent.selfFallback
      : row?.[parentId];
  if (!sourceRule?.status) {
    throw new Error(
      `${passportId}->${policy.destinationNumeric}: parent rule ${parentId} is missing`
    );
  }
  const mappedStatus =
    parent.statusMap?.[sourceRule.status] ??
    parent.unmappedStatus ??
    sourceRule.status;
  return {
    status: mappedStatus,
    ...(mappedStatus === sourceRule.status && Number.isInteger(sourceRule.days)
      ? { days: sourceRule.days }
      : {}),
  };
}

export function expectedOfficialTerritoryRule({
  policy,
  passportId,
  passportIso2,
  row,
  context,
}) {
  let selected = parentDerivedRule({ policy, passportId, row, context });
  if (!selected) selected = structuredClone(policy.defaultRule);
  const matchedGroupConditions = [];

  for (const override of policy.rules ?? []) {
    if (ruleMatchesPassport(override, passportIso2, context)) {
      selected = compactRule(override);
      if (override.note) selected.note = override.note;
      for (const groupId of override.passportGroupIds ?? []) {
        const group = context.groupDefinitionById.get(groupId);
        if (group?.conditionsByPassportIso2?.[passportIso2]) {
          matchedGroupConditions.push(
            group.conditionsByPassportIso2[passportIso2]
          );
        }
      }
    }
  }

  if (!selected?.status) {
    throw new Error(
      `${policy.id}: no status for passport ${passportIso2} (${passportId})`
    );
  }

  const condition = policy.conditionsByPassportIso2?.[passportIso2];
  const note = joinNotes(
    policy.note,
    selected.note,
    matchedGroupConditions,
    condition
  );
  return {
    status: selected.status,
    ...(Number.isInteger(selected.days) && selected.days > 0
      ? { days: selected.days }
      : {}),
    territoryPolicyId: `territory-${policy.destinationIso2.toLowerCase()}-official-${policy.id}`,
    source: policy.source,
    sourceUrl: policy.sourceUrl,
    sourceType: "official",
    updated: policy.verifiedAt,
    ...(note ? { note } : {}),
  };
}

export function applyOfficialTerritoryPolicies({
  database,
  destinationManifest,
  policyDatabase,
}) {
  const next = structuredClone(database);
  const context = buildTerritoryPolicyContext({
    policyDatabase,
    destinationManifest,
  });
  const numericToIso2 = Object.fromEntries(
    destinationManifest.destinations.map((destination) => [
      String(destination.numeric),
      destination.iso2,
    ])
  );
  let changedRules = 0;
  const changedByDestination = {};

  for (const policy of context.policyById.values()) {
    const destinationId = String(policy.destinationNumeric);
    for (const [passportId, row] of Object.entries(next.passports ?? {})) {
      if (passportId === destinationId) continue;
      const passportIso2 = numericToIso2[passportId];
      if (!passportIso2) {
        throw new Error(`${policy.id}: unknown passport numeric ${passportId}`);
      }
      const desired = expectedOfficialTerritoryRule({
        policy,
        passportId,
        passportIso2,
        row,
        context,
      });
      if (!sameValue(row[destinationId], desired)) {
        row[destinationId] = desired;
        changedRules += 1;
        changedByDestination[policy.destinationIso2] =
          (changedByDestination[policy.destinationIso2] ?? 0) + 1;
      }
    }
  }

  return { database: next, context, changedRules, changedByDestination };
}

export function auditOfficialTerritoryPolicies({
  database,
  destinationManifest,
  policyDatabase,
}) {
  const errors = [];
  let context;
  try {
    context = buildTerritoryPolicyContext({
      policyDatabase,
      destinationManifest,
    });
  } catch (error) {
    return { ok: false, errors: [error.message], checkedRules: 0 };
  }
  const numericToIso2 = Object.fromEntries(
    destinationManifest.destinations.map((destination) => [
      String(destination.numeric),
      destination.iso2,
    ])
  );
  let checkedRules = 0;

  for (const policy of context.policyById.values()) {
    const destinationId = String(policy.destinationNumeric);
    for (const [passportId, row] of Object.entries(database.passports ?? {})) {
      if (passportId === destinationId) continue;
      checkedRules += 1;
      let expected;
      try {
        expected = expectedOfficialTerritoryRule({
          policy,
          passportId,
          passportIso2: numericToIso2[passportId],
          row,
          context,
        });
      } catch (error) {
        errors.push(error.message);
        continue;
      }
      if (!sameValue(row?.[destinationId], expected)) {
        errors.push(
          `${passportId}:${destinationId}: ${policy.destinationIso2} official matrix mismatch; ` +
            `expected ${expected.status}, found ${row?.[destinationId]?.status ?? "missing"}`
        );
      }
      if (errors.length >= 200) break;
    }
  }

  return { ok: errors.length === 0, errors, checkedRules };
}
