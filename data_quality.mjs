import fs from "node:fs";
import path from "node:path";

export const QUALITY_POLICY_FILE = "data_quality_policy.json";
export const REGRESSION_RULES_FILE = "regression_rules.json";
export const FREEDOM_REGISTRY_FILE = "freedom_registry.json";
export const TERRITORY_AUDIT_REGISTRY_FILE = "territory_audit_registry.json";

export function readJsonFile(filename) {
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

export function loadQualityArtifacts(baseDir = process.cwd()) {
  const read = (name) => readJsonFile(path.resolve(baseDir, name));
  const policy = read(QUALITY_POLICY_FILE);
  const regressions = read(REGRESSION_RULES_FILE);
  const freedomRegistry = read(FREEDOM_REGISTRY_FILE);
  const territoryAuditRegistry = read(TERRITORY_AUDIT_REGISTRY_FILE);

  if (policy.schemaVersion !== 1) {
    throw new Error(`${QUALITY_POLICY_FILE}: unsupported schemaVersion`);
  }
  if (regressions.schemaVersion !== 1 || !Array.isArray(regressions.rules)) {
    throw new Error(`${REGRESSION_RULES_FILE}: unsupported schema`);
  }
  if (
    freedomRegistry.schemaVersion !== 1 ||
    !Array.isArray(freedomRegistry.entries)
  ) {
    throw new Error(`${FREEDOM_REGISTRY_FILE}: unsupported schema`);
  }
  if (
    territoryAuditRegistry.schemaVersion !== 1 ||
    !Array.isArray(territoryAuditRegistry.territories) ||
    !Array.isArray(territoryAuditRegistry.sharedPolicies)
  ) {
    throw new Error(`${TERRITORY_AUDIT_REGISTRY_FILE}: unsupported schema`);
  }

  return { policy, regressions, freedomRegistry, territoryAuditRegistry };
}

export function ruleKey(passportId, destinationId) {
  return `${String(passportId)}:${String(destinationId)}`;
}

function stableRule(rule) {
  const out = { status: rule?.status };
  if (Number.isFinite(rule?.days) && rule.days > 0) out.days = rule.days;
  return out;
}

function sameExpectedRule(actual, expected) {
  if (!actual || actual.status !== expected?.status) return false;
  if (expected?.days !== undefined && actual.days !== expected.days) return false;
  return true;
}

function isRuleAuthoritative(rule) {
  if (!rule) return false;
  if (rule.officialPolicyId) return true;
  return Boolean(rule.source && rule.sourceUrl && rule.updated);
}

export function buildFreedomRegistryMap(freedomRegistry) {
  const result = new Map();
  for (const entry of freedomRegistry.entries ?? []) {
    const key = ruleKey(entry.passportNumeric, entry.destinationNumeric);
    if (result.has(key)) {
      throw new Error(`${FREEDOM_REGISTRY_FILE}: duplicate pair ${key}`);
    }
    result.set(key, entry);
  }
  return result;
}

function activeOfficialPolicyPairs(officialRulePolicies, today) {
  const result = new Map();
  for (const policy of officialRulePolicies?.policies ?? []) {
    const active =
      (!policy.validFrom || today >= policy.validFrom) &&
      (!policy.validUntil || today <= policy.validUntil);
    if (!active) continue;

    for (const passportId of policy.passportNumerics ?? []) {
      const key = ruleKey(passportId, policy.destinationNumeric);
      if (result.has(key)) {
        throw new Error(`Official policies overlap at ${key}`);
      }
      result.set(key, policy);
    }
  }
  return result;
}


const NON_CORE_SOURCE_KINDS = new Set([
  "extended-227",
  "extended-fw-split",
  "derived-territory",
]);

export function shouldFreezeExistingNonCoreRule({ currentRule, sourceKind, policy }) {
  return Boolean(
    currentRule &&
      NON_CORE_SOURCE_KINDS.has(sourceKind) &&
      policy?.automaticChanges?.freezeExistingNonCoreDestinations === true
  );
}

function expectedSharedOfficialListStatus(policy, destinationId, passportId) {
  const visaFree = new Set((policy.visaFreePassportNumerics ?? []).map(String));
  const exception = policy.destinationExceptions?.[String(destinationId)] ?? {};
  for (const removed of exception.removeVisaFreePassportNumerics ?? []) {
    visaFree.delete(String(removed));
  }
  for (const added of exception.addVisaFreePassportNumerics ?? []) {
    visaFree.add(String(added));
  }
  return visaFree.has(String(passportId)) ? "visa free" : "visa required";
}

export function auditTerritoryPolicies({
  database,
  destinationManifest,
  baseDir = process.cwd(),
  today = new Date().toISOString().slice(0, 10),
}) {
  const { territoryAuditRegistry } = loadQualityArtifacts(baseDir);
  const errors = [];
  const warnings = [];
  const passports = database.passports ?? {};
  const destinations = destinationManifest.destinations ?? [];
  const destinationById = new Map(destinations.map((item) => [String(item.numeric), item]));
  const nonCore = destinations.filter((item) => NON_CORE_SOURCE_KINDS.has(item.sourceKind));
  const nonCoreIds = new Set(nonCore.map((item) => String(item.numeric)));
  const entries = territoryAuditRegistry.territories ?? [];
  const entryByDestination = new Map();
  const sharedPolicyById = new Map();

  for (const shared of territoryAuditRegistry.sharedPolicies ?? []) {
    if (!shared.id || sharedPolicyById.has(shared.id)) {
      errors.push(`${TERRITORY_AUDIT_REGISTRY_FILE}: duplicate/empty shared policy id ${shared.id}`);
      continue;
    }
    sharedPolicyById.set(shared.id, shared);
  }

  for (const entry of entries) {
    const destinationId = String(entry.destinationNumeric);
    if (entryByDestination.has(destinationId)) {
      errors.push(`${TERRITORY_AUDIT_REGISTRY_FILE}: duplicate destination ${destinationId}`);
      continue;
    }
    entryByDestination.set(destinationId, entry);
    const manifest = destinationById.get(destinationId);
    if (!manifest) {
      errors.push(`${TERRITORY_AUDIT_REGISTRY_FILE}: unsupported destination ${destinationId}`);
      continue;
    }
    if (!nonCoreIds.has(destinationId)) {
      errors.push(`${entry.iso2 ?? destinationId}: registry entry is not a non-core destination`);
    }
    if (manifest.iso2 !== entry.iso2 || manifest.sourceKind !== entry.sourceKind) {
      errors.push(`${entry.iso2 ?? destinationId}: registry/manifest identity mismatch`);
    }
    if (entry.updateMode !== "freeze") {
      errors.push(`${entry.iso2}: non-core territory must use updateMode=freeze`);
    }
  }

  for (const destination of nonCore) {
    if (!entryByDestination.has(String(destination.numeric))) {
      errors.push(`${destination.iso2}: non-core destination is missing from ${TERRITORY_AUDIT_REGISTRY_FILE}`);
    }
  }
  for (const destinationId of entryByDestination.keys()) {
    if (!nonCoreIds.has(destinationId)) {
      errors.push(`${destinationId}: registry contains destination outside non-core set`);
    }
  }

  const counts = {
    totalNonCore: nonCore.length,
    registryEntries: entries.length,
    registryCoverageGaps: Math.max(0, nonCore.length - [...nonCoreIds].filter((id) => entryByDestination.has(id)).length),
    mirrorParent: 0,
    sharedOfficialList: 0,
    fixedStatus: 0,
    pendingDedicated: 0,
    certified: 0,
    modelSafety: 0,
    checkedRules: 0,
  };
  const pendingDestinations = [];

  for (const entry of entries) {
    const destinationId = String(entry.destinationNumeric);
    if (!destinationById.has(destinationId)) continue;

    if (entry.linkageStatus === "pending-dedicated-audit") {
      counts.pendingDedicated += 1;
      pendingDestinations.push(entry.iso2);
    } else if (String(entry.linkageStatus).includes("certified")) {
      counts.certified += 1;
    } else if (entry.linkageStatus === "model-safety") {
      counts.modelSafety += 1;
    }

    if (entry.policyMode === "freeze-dedicated") {
      continue;
    }

    if (entry.policyMode === "mirror-parent-category") {
      counts.mirrorParent += 1;
      const parentId = String(entry.parentNumeric ?? "");
      if (!destinationById.has(parentId)) {
        errors.push(`${entry.iso2}: invalid mirror parent ${parentId}`);
        continue;
      }
      if (!entry.officialSource || !entry.officialSourceUrl || !entry.verifiedAt) {
        errors.push(`${entry.iso2}: certified mirror lacks official linkage metadata`);
      }
      const parentIso2 = destinationById.get(parentId)?.iso2?.toLowerCase();
      const expectedPolicyId = `territory-${entry.iso2.toLowerCase()}-mirror-${parentIso2}`;
      for (const [passportId, row] of Object.entries(passports)) {
        const actual = row?.[destinationId];
        const parent = passportId === parentId
          ? (entry.selfFallback ? { status: entry.selfFallback } : null)
          : row?.[parentId];
        counts.checkedRules += 1;
        if (!actual || !parent || actual.status !== parent.status) {
          errors.push(
            `${passportId}:${destinationId}: ${entry.iso2} must mirror parent category ${parentId}; ` +
              `found ${actual?.status ?? "missing"}, parent=${parent?.status ?? "missing"}`
          );
        }
        if (actual?.territoryPolicyId !== expectedPolicyId) {
          errors.push(`${passportId}:${destinationId}: ${entry.iso2} mirror rule lacks territoryPolicyId ${expectedPolicyId}`);
        }
      }
      continue;
    }

    if (entry.policyMode === "shared-official-list") {
      counts.sharedOfficialList += 1;
      const shared = sharedPolicyById.get(entry.sharedPolicyId);
      if (!shared) {
        errors.push(`${entry.iso2}: missing shared policy ${entry.sharedPolicyId}`);
        continue;
      }
      if (!shared.source || !shared.sourceUrl || !shared.verifiedAt) {
        errors.push(`${shared.id}: incomplete official source metadata`);
      }
      for (const [passportId, row] of Object.entries(passports)) {
        const actual = row?.[destinationId];
        const expectedStatus = expectedSharedOfficialListStatus(shared, destinationId, passportId);
        const expectedPolicyId = `${shared.id}:${entry.iso2}`;
        counts.checkedRules += 1;
        if (actual?.status !== expectedStatus) {
          errors.push(`${passportId}:${destinationId}: ${entry.iso2} expected ${expectedStatus}, found ${actual?.status ?? "missing"}`);
        }
        if (
          actual?.territoryPolicyId !== expectedPolicyId ||
          !actual?.source || !actual?.sourceUrl || !actual?.updated
        ) {
          errors.push(`${passportId}:${destinationId}: ${entry.iso2} shared official rule lacks protection metadata`);
        }
      }
      continue;
    }

    if (entry.policyMode === "fixed-status") {
      counts.fixedStatus += 1;
      if (!entry.expected?.status) {
        errors.push(`${entry.iso2}: fixed-status entry has no expected.status`);
        continue;
      }
      const expectedPolicyId = `territory-${entry.iso2.toLowerCase()}-v8-safety`;
      for (const [passportId, row] of Object.entries(passports)) {
        const actual = row?.[destinationId];
        counts.checkedRules += 1;
        if (!sameExpectedRule(actual, entry.expected)) {
          errors.push(
            `${passportId}:${destinationId}: ${entry.iso2} expected ${entry.expected.status}` +
              `${entry.expected.days ? `/${entry.expected.days}` : ""}, found ${actual?.status ?? "missing"}` +
              `${actual?.days ? `/${actual.days}` : ""}`
          );
        }
        if (actual?.territoryPolicyId !== expectedPolicyId || !actual?.updated) {
          errors.push(`${passportId}:${destinationId}: ${entry.iso2} fixed safety rule lacks territoryPolicyId/updated`);
        }
        if (
          String(entry.linkageStatus).includes("certified") &&
          (!actual?.source || !actual?.sourceUrl)
        ) {
          errors.push(`${passportId}:${destinationId}: ${entry.iso2} certified fixed rule lacks official source metadata`);
        }
      }
      continue;
    }

    errors.push(`${entry.iso2}: unsupported territory policyMode ${entry.policyMode}`);
  }

  if (counts.pendingDedicated > 0) {
    warnings.push(
      `${counts.pendingDedicated} non-core destinations remain frozen pending dedicated official audit: ` +
        pendingDestinations.join(", ")
    );
  }

  return {
    ok: errors.length === 0,
    checkedAt: today,
    errors,
    warnings,
    metrics: counts,
    pendingDestinations,
  };
}

export function auditDatabaseQuality({
  database,
  destinationManifest,
  officialRulePolicies,
  specialMobilityWatches,
  territoryDerivations,
  baseDir = process.cwd(),
  today = new Date().toISOString().slice(0, 10),
}) {
  const { policy, regressions, freedomRegistry } = loadQualityArtifacts(baseDir);
  const errors = [];
  const warnings = [];
  const passports = database.passports ?? {};
  const destinationById = new Map(
    (destinationManifest.destinations ?? []).map((item) => [
      String(item.numeric),
      item,
    ])
  );
  const passportIds = new Set(Object.keys(passports));
  const freedomMap = buildFreedomRegistryMap(freedomRegistry);
  const officialPairs = activeOfficialPolicyPairs(officialRulePolicies, today);

  // 1. Freedom of movement is closed by default. The general feeds may never
  // invent this category merely from a visa-free rule.
  const databaseFreedomKeys = new Set();
  for (const [passportId, rules] of Object.entries(passports)) {
    for (const [destinationId, rule] of Object.entries(rules ?? {})) {
      if (rule?.status !== "freedom") continue;
      const key = ruleKey(passportId, destinationId);
      databaseFreedomKeys.add(key);
      if (!freedomMap.has(key)) {
        errors.push(
          `${key}: freedom is not present in ${FREEDOM_REGISTRY_FILE}`
        );
      }
      if (!isRuleAuthoritative(rule)) {
        errors.push(`${key}: freedom rule lacks authoritative source metadata`);
      }
    }
  }
  for (const [key, entry] of freedomMap.entries()) {
    const [passportId, destinationId] = key.split(":");
    const rule = passports[passportId]?.[destinationId];
    if (rule?.status !== "freedom") {
      errors.push(
        `${key}: freedom registry ${entry.id} expects freedom, found ${
          rule?.status ?? "missing"
        }`
      );
    }
  }

  // A mobility watcher capable of producing freedom must itself be registered.
  const freedomWatchIds = new Set(
    [...freedomMap.values()].map((entry) => entry.id).filter(Boolean)
  );
  for (const watch of specialMobilityWatches?.watches ?? []) {
    if (!freedomWatchIds.has(watch.id)) {
      errors.push(
        `${watch.id}: special mobility watcher is not allow-listed in ${FREEDOM_REGISTRY_FILE}`
      );
    }
  }

  // 2. Active official policies are immutable against lower-priority feeds.
  for (const [key, officialPolicy] of officialPairs.entries()) {
    const [passportId, destinationId] = key.split(":");
    const rule = passports[passportId]?.[destinationId];
    if (!sameExpectedRule(rule, officialPolicy.rule)) {
      errors.push(
        `${key}: official policy ${officialPolicy.id} expects ${
          officialPolicy.rule.status
        }${
          officialPolicy.rule.days ? `/${officialPolicy.rule.days}` : ""
        }, found ${rule?.status ?? "missing"}${rule?.days ? `/${rule.days}` : ""}`
      );
    }
    if (
      rule?.officialPolicyId !== officialPolicy.id ||
      !rule?.source ||
      !rule?.sourceUrl ||
      !rule?.updated
    ) {
      errors.push(`${key}: official policy ${officialPolicy.id} is not fully protected`);
    }
  }

  // 3. Regression rules protect known-good edge cases against future imports.
  for (const regression of regressions.rules ?? []) {
    const passportId = String(regression.passportNumeric);
    const destinationId = String(regression.destinationNumeric);
    const key = ruleKey(passportId, destinationId);
    const rule = passports[passportId]?.[destinationId];

    if (!passportIds.has(passportId) || !destinationById.has(destinationId)) {
      errors.push(`${regression.id}: unsupported regression pair ${key}`);
      continue;
    }
    if (regression.expected && !sameExpectedRule(rule, regression.expected)) {
      errors.push(
        `${key}: regression ${regression.id} expected ${
          regression.expected.status
        }${
          regression.expected.days ? `/${regression.expected.days}` : ""
        }, found ${rule?.status ?? "missing"}${rule?.days ? `/${rule.days}` : ""}`
      );
    }
    if (
      Array.isArray(regression.forbiddenStatuses) &&
      regression.forbiddenStatuses.includes(rule?.status)
    ) {
      errors.push(
        `${key}: regression ${regression.id} forbids status ${rule.status}`
      );
    }
    if (regression.requireAuthoritativeSource && !isRuleAuthoritative(rule)) {
      errors.push(`${key}: regression ${regression.id} lacks authoritative metadata`);
    }
  }

  // 4. Every non-core destination is controlled by the v8 territory registry.
  // Certified linkages/fixed rules are actively verified; destinations that still
  // need a dedicated government-source audit are frozen and reported as backlog.
  const territoryAudit = auditTerritoryPolicies({
    database,
    destinationManifest,
    baseDir,
    today,
  });
  errors.push(...territoryAudit.errors);
  warnings.push(...territoryAudit.warnings);

  // 5. Risk inventory: count sensitive statuses that do not yet have dedicated
  // source metadata and are not already protected by the territory registry.
  // This is reported, not failed, because the remaining backlog is reviewed in stages.
  const unverifiedSensitive = {};
  for (const status of policy.sensitiveStatuses ?? []) unverifiedSensitive[status] = 0;
  for (const rules of Object.values(passports)) {
    for (const rule of Object.values(rules ?? {})) {
      if (
        Object.hasOwn(unverifiedSensitive, rule?.status) &&
        !isRuleAuthoritative(rule) &&
        !rule?.territoryPolicyId
      ) {
        unverifiedSensitive[rule.status] += 1;
      }
    }
  }
  const unverifiedSensitiveTotal = Object.values(unverifiedSensitive).reduce(
    (sum, value) => sum + value,
    0
  );
  if (unverifiedSensitiveTotal > 0) {
    warnings.push(
      `Historical sensitive rules still requiring audit: ${JSON.stringify(
        unverifiedSensitive
      )}`
    );
  }

  return {
    ok: errors.length === 0,
    mode: policy.mode,
    checkedAt: today,
    errors,
    warnings,
    metrics: {
      passports: Object.keys(passports).length,
      destinations: destinationManifest.destinations?.length ?? 0,
      officialProtectedPairs: officialPairs.size,
      regressionRules: regressions.rules?.length ?? 0,
      freedomRules: databaseFreedomKeys.size,
      freedomRegistryPairs: freedomMap.size,
      territoryAudit: territoryAudit.metrics,
      unverifiedSensitive,
    },
  };
}

export function compareCandidateSafety({
  before,
  after,
  destinationManifest,
  baseDir = process.cwd(),
}) {
  const { policy, freedomRegistry } = loadQualityArtifacts(baseDir);
  const freedomMap = buildFreedomRegistryMap(freedomRegistry);
  const destinationById = new Map(
    (destinationManifest.destinations ?? []).map((item) => [
      String(item.numeric),
      item,
    ])
  );
  const changes = [];
  const byPassport = new Map();
  const byDestination = new Map();
  let unverifiedCategoryChanges = 0;
  let unverifiedRestrictiveChanges = 0;
  let newFreedomRules = 0;

  const restrictive = new Set(policy.restrictiveStatuses ?? []);
  const passportIds = new Set([
    ...Object.keys(before.passports ?? {}),
    ...Object.keys(after.passports ?? {}),
  ]);

  for (const passportId of passportIds) {
    const beforeRow = before.passports?.[passportId] ?? {};
    const afterRow = after.passports?.[passportId] ?? {};
    const destinationIds = new Set([
      ...Object.keys(beforeRow),
      ...Object.keys(afterRow),
    ]);

    for (const destinationId of destinationIds) {
      const oldRule = beforeRow[destinationId];
      const newRule = afterRow[destinationId];
      if (!oldRule || !newRule || oldRule.status === newRule.status) continue;

      const key = ruleKey(passportId, destinationId);
      const authoritative = isRuleAuthoritative(newRule);
      const item = {
        key,
        passportId,
        destinationId,
        destinationIso2: destinationById.get(destinationId)?.iso2 ?? null,
        sourceKind: destinationById.get(destinationId)?.sourceKind ?? null,
        before: stableRule(oldRule),
        after: stableRule(newRule),
        authoritative,
      };
      changes.push(item);
      byPassport.set(passportId, (byPassport.get(passportId) ?? 0) + 1);
      byDestination.set(
        destinationId,
        (byDestination.get(destinationId) ?? 0) + 1
      );

      if (!authoritative) unverifiedCategoryChanges += 1;
      if (!authoritative && restrictive.has(newRule.status)) {
        unverifiedRestrictiveChanges += 1;
      }
      if (
        newRule.status === "freedom" &&
        oldRule.status !== "freedom" &&
        !freedomMap.has(key)
      ) {
        newFreedomRules += 1;
      }
    }
  }

  const maxPerPassport = Math.max(0, ...byPassport.values());
  const maxPerDestination = Math.max(0, ...byDestination.values());
  const limits = policy.candidateLimits ?? {};
  const errors = [];

  if (changes.length > (limits.maxTotalCategoryChanges ?? Infinity)) {
    errors.push(
      `Category changes ${changes.length} exceed limit ${limits.maxTotalCategoryChanges}`
    );
  }
  if (maxPerPassport > (limits.maxCategoryChangesPerPassport ?? Infinity)) {
    errors.push(
      `Per-passport category changes ${maxPerPassport} exceed limit ${limits.maxCategoryChangesPerPassport}`
    );
  }
  if (
    maxPerDestination > (limits.maxCategoryChangesPerDestination ?? Infinity)
  ) {
    errors.push(
      `Per-destination category changes ${maxPerDestination} exceed limit ${limits.maxCategoryChangesPerDestination}`
    );
  }
  if (
    unverifiedCategoryChanges >
    (limits.maxUnverifiedCategoryChanges ?? Infinity)
  ) {
    errors.push(
      `Unverified category changes ${unverifiedCategoryChanges} exceed limit ${limits.maxUnverifiedCategoryChanges}`
    );
  }
  if (
    unverifiedRestrictiveChanges >
    (limits.maxUnverifiedRestrictiveChanges ?? Infinity)
  ) {
    errors.push(
      `Unverified restrictive changes ${unverifiedRestrictiveChanges} exceed limit ${limits.maxUnverifiedRestrictiveChanges}`
    );
  }
  if (newFreedomRules > (limits.maxNewFreedomRules ?? Infinity)) {
    errors.push(
      `Unregistered new freedom rules ${newFreedomRules} exceed limit ${limits.maxNewFreedomRules}`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    metrics: {
      categoryChanges: changes.length,
      maxPerPassport,
      maxPerDestination,
      unverifiedCategoryChanges,
      unverifiedRestrictiveChanges,
      newFreedomRules,
    },
    changes: changes.slice(0, 250),
  };
}

export function writeJsonFile(filename, value) {
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + "\n");
}
