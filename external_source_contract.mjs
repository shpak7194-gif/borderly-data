import crypto from "node:crypto";
import { normalizePassportIndexRule } from "./passport_index_contract.mjs";

const ISO2_PATTERN = /^[A-Z]{2}$/;

function normalizedIso2(value, label) {
  const iso2 = String(value ?? "").trim().toUpperCase();
  if (!ISO2_PATTERN.test(iso2)) {
    throw new Error(`${label} must be an ISO-2 code, found ${JSON.stringify(value)}`);
  }
  return iso2;
}

function canonicalRule(rule, label) {
  try {
    return normalizePassportIndexRule({
      ...rule,
      status: String(rule?.status ?? "").trim().toLowerCase(),
    });
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text ?? "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function csvRequirementToRule(requirement, label) {
  const value = String(requirement ?? "").trim().toLowerCase();
  if (/^\d+$/.test(value)) {
    const days = Number(value);
    return canonicalRule({ status: "visa free", days }, label);
  }
  if (value === "-1") return null;
  return canonicalRule({ status: value }, label);
}

export function parseTidyIso2Csv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("Candidate CSV is empty");
  const header = rows[0].map((value) => value.trim().toLowerCase());
  const passportIndex = header.indexOf("passport");
  const destinationIndex = header.indexOf("destination");
  const requirementIndex = header.indexOf("requirement");
  if ([passportIndex, destinationIndex, requirementIndex].includes(-1)) {
    throw new Error("Candidate CSV must contain Passport, Destination and Requirement columns");
  }

  const dataset = {};
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const passport = normalizedIso2(row[passportIndex], `CSV row ${rowIndex + 1} passport`);
    const destination = normalizedIso2(
      row[destinationIndex],
      `CSV row ${rowIndex + 1} destination`
    );
    const rule = csvRequirementToRule(
      row[requirementIndex],
      `CSV row ${rowIndex + 1} ${passport}->${destination}`
    );
    if (!rule) {
      if (passport !== destination) {
        throw new Error(`CSV row ${rowIndex + 1}: -1 is allowed only for a self pair`);
      }
      continue;
    }
    if (passport === destination) {
      throw new Error(`CSV row ${rowIndex + 1}: self pair must use -1`);
    }
    dataset[passport] ??= {};
    if (dataset[passport][destination]) {
      throw new Error(`Duplicate candidate rule ${passport}->${destination}`);
    }
    dataset[passport][destination] = rule;
  }
  return dataset;
}

export function normalizeCandidateDataset(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Candidate dataset must be an object keyed by passport ISO-2 code");
  }
  const dataset = {};
  for (const [rawPassport, row] of Object.entries(value)) {
    const passport = normalizedIso2(rawPassport, "Candidate passport");
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`Candidate row ${passport} must be an object`);
    }
    dataset[passport] ??= {};
    for (const [rawDestination, rawRule] of Object.entries(row)) {
      const destination = normalizedIso2(
        rawDestination,
        `Candidate destination for ${passport}`
      );
      if (destination === passport) {
        throw new Error(`Candidate dataset contains self pair ${passport}->${destination}`);
      }
      if (dataset[passport][destination]) {
        throw new Error(`Duplicate candidate rule ${passport}->${destination}`);
      }
      dataset[passport][destination] = canonicalRule(
        rawRule,
        `Candidate rule ${passport}->${destination}`
      );
    }
  }
  return dataset;
}

export function parseCandidateDataset(text, format) {
  if (format === "passport-index-json") {
    return normalizeCandidateDataset(JSON.parse(text));
  }
  if (format === "passport-index-tidy-iso2-csv") {
    return parseTidyIso2Csv(text);
  }
  throw new Error(`Unsupported candidate dataset format: ${format}`);
}

export function datasetMetrics(dataset) {
  const statusCounts = {};
  let ruleCount = 0;
  for (const row of Object.values(dataset ?? {})) {
    for (const rule of Object.values(row ?? {})) {
      ruleCount += 1;
      statusCounts[rule.status] = (statusCounts[rule.status] ?? 0) + 1;
    }
  }
  return {
    passportCount: Object.keys(dataset ?? {}).length,
    ruleCount,
    statusCounts,
  };
}

function hasKnownStayLength(rule) {
  return Number.isInteger(rule?.days);
}

export function compareCandidateDataset(baseline, candidate, maxDetails = 500) {
  const categoryChanges = [];
  const stayLengthChanges = [];
  const stayLengthCoverageGaps = [];
  const missingRules = [];
  const extraRules = [];
  let unchangedRules = 0;

  for (const [passport, row] of Object.entries(baseline ?? {})) {
    for (const [destination, baselineRule] of Object.entries(row ?? {})) {
      const candidateRule = candidate?.[passport]?.[destination];
      if (!candidateRule) {
        if (missingRules.length < maxDetails) missingRules.push(`${passport}->${destination}`);
      } else if (baselineRule.status !== candidateRule.status) {
        if (categoryChanges.length < maxDetails) {
          categoryChanges.push({
            passport,
            destination,
            before: baselineRule,
            after: candidateRule,
          });
        }
      } else if (
        hasKnownStayLength(baselineRule) &&
        hasKnownStayLength(candidateRule) &&
        baselineRule.days !== candidateRule.days
      ) {
        if (stayLengthChanges.length < maxDetails) {
          stayLengthChanges.push({
            passport,
            destination,
            before: baselineRule,
            after: candidateRule,
          });
        }
      } else if (
        hasKnownStayLength(baselineRule) !== hasKnownStayLength(candidateRule)
      ) {
        if (stayLengthCoverageGaps.length < maxDetails) {
          stayLengthCoverageGaps.push({
            passport,
            destination,
            baseline: baselineRule,
            candidate: candidateRule,
            missingFrom: hasKnownStayLength(baselineRule) ? "candidate" : "baseline",
          });
        }
      } else {
        unchangedRules += 1;
      }
    }
  }

  const baselinePairs = new Set();
  for (const [passport, row] of Object.entries(baseline ?? {})) {
    for (const destination of Object.keys(row ?? {})) {
      baselinePairs.add(`${passport}->${destination}`);
    }
  }
  for (const [passport, row] of Object.entries(candidate ?? {})) {
    for (const [destination, rule] of Object.entries(row ?? {})) {
      const pair = `${passport}->${destination}`;
      if (!baselinePairs.has(pair) && extraRules.length < maxDetails) {
        extraRules.push({ passport, destination, rule });
      }
    }
  }

  const baselineMetrics = datasetMetrics(baseline);
  const candidateMetrics = datasetMetrics(candidate);
  const categoryChangeCount = Object.entries(baseline ?? {}).reduce(
    (count, [passport, row]) =>
      count + Object.entries(row ?? {}).filter(
        ([destination, rule]) =>
          candidate?.[passport]?.[destination] &&
          candidate[passport][destination].status !== rule.status
      ).length,
    0
  );
  const stayLengthChangeCount = Object.entries(baseline ?? {}).reduce(
    (count, [passport, row]) =>
      count + Object.entries(row ?? {}).filter(([destination, rule]) => {
        const next = candidate?.[passport]?.[destination];
        return (
          next &&
          next.status === rule.status &&
          hasKnownStayLength(rule) &&
          hasKnownStayLength(next) &&
          next.days !== rule.days
        );
      }).length,
    0
  );
  const stayLengthCoverageGapCount = Object.entries(baseline ?? {}).reduce(
    (count, [passport, row]) =>
      count + Object.entries(row ?? {}).filter(([destination, rule]) => {
        const next = candidate?.[passport]?.[destination];
        return (
          next &&
          next.status === rule.status &&
          hasKnownStayLength(rule) !== hasKnownStayLength(next)
        );
      }).length,
    0
  );
  const missingRuleCount = baselineMetrics.ruleCount -
    Object.entries(baseline ?? {}).reduce(
      (count, [passport, row]) =>
        count + Object.keys(row ?? {}).filter((destination) => candidate?.[passport]?.[destination]).length,
      0
    );
  const extraRuleCount = candidateMetrics.ruleCount -
    Object.entries(candidate ?? {}).reduce(
      (count, [passport, row]) =>
        count + Object.keys(row ?? {}).filter((destination) => baseline?.[passport]?.[destination]).length,
      0
    );

  return {
    baselineMetrics,
    candidateMetrics,
    unchangedRules,
    categoryChangeCount,
    stayLengthChangeCount,
    stayLengthCoverageGapCount,
    missingRuleCount,
    extraRuleCount,
    detailsTruncated:
      categoryChangeCount > categoryChanges.length ||
      stayLengthChangeCount > stayLengthChanges.length ||
      stayLengthCoverageGapCount > stayLengthCoverageGaps.length ||
      missingRuleCount > missingRules.length ||
      extraRuleCount > extraRules.length,
    categoryChanges,
    stayLengthChanges,
    stayLengthCoverageGaps,
    missingRules,
    extraRules,
  };
}

export function validateDatasetThresholds(dataset, source) {
  const metrics = datasetMetrics(dataset);
  const errors = [];
  if (metrics.passportCount < source.minimumPassportCount) {
    errors.push(
      `passport count ${metrics.passportCount} is below ${source.minimumPassportCount}`
    );
  }
  if (metrics.ruleCount < source.minimumRuleCount) {
    errors.push(`rule count ${metrics.ruleCount} is below ${source.minimumRuleCount}`);
  }
  return { ok: errors.length === 0, errors, metrics };
}

export function ageInDays(dateValue, now = new Date()) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

export function freshnessState(ageDays, policy) {
  if (ageDays === null) return "unknown";
  if (ageDays < -1) return "future-date";
  if (ageDays >= policy.criticalAfterDays) return "critical";
  if (ageDays >= policy.warningAfterDays) return "warning";
  return "fresh";
}

export function hasIndependentCorroboration(sourceIds, registry) {
  const byId = new Map((registry.sources ?? []).map((source) => [source.id, source]));
  const families = new Set(
    sourceIds.map((id) => byId.get(id)?.sourceFamily).filter(Boolean)
  );
  return families.size >= 2;
}

export function findDatasetConflicts(sourceDatasets, maxDetails = 200) {
  const pairs = new Set();
  for (const { dataset } of sourceDatasets) {
    for (const [passport, row] of Object.entries(dataset ?? {})) {
      for (const destination of Object.keys(row ?? {})) {
        pairs.add(`${passport}->${destination}`);
      }
    }
  }

  let conflictCount = 0;
  let categoryConflictCount = 0;
  let stayLengthConflictCount = 0;
  const conflicts = [];
  for (const pair of [...pairs].sort()) {
    const [passport, destination] = pair.split("->");
    const rules = sourceDatasets
      .map(({ id, dataset }) => ({ id, rule: dataset?.[passport]?.[destination] ?? null }))
      .filter(({ rule }) => rule);
    const statuses = new Set(rules.map(({ rule }) => rule.status));
    let conflictType = null;
    if (statuses.size > 1) {
      conflictType = "category";
      categoryConflictCount += 1;
    } else {
      const knownStayLengths = new Set(
        rules
          .map(({ rule }) => rule.days)
          .filter((days) => Number.isInteger(days))
      );
      if (knownStayLengths.size > 1) {
        conflictType = "stay-length";
        stayLengthConflictCount += 1;
      }
    }
    if (!conflictType) continue;
    conflictCount += 1;
    if (conflicts.length < maxDetails) {
      conflicts.push({ passport, destination, conflictType, sources: rules });
    }
  }
  return {
    conflictCount,
    categoryConflictCount,
    stayLengthConflictCount,
    detailsTruncated: conflictCount > conflicts.length,
    conflicts,
  };
}

export function candidateDecision(diff, source) {
  const changeCount =
    diff.categoryChangeCount +
    diff.stayLengthChangeCount +
    diff.missingRuleCount +
    diff.extraRuleCount;
  if (changeCount === 0) {
    return {
      state: "unchanged",
      automaticPublicationAllowed: false,
      reason:
        (diff.stayLengthCoverageGapCount ?? 0) > 0
          ? "No confirmed rule changes were found; missing stay lengths are recorded as coverage gaps."
          : "Candidate matches the approved Passport Index snapshot.",
    };
  }
  return {
    state: "review-required",
    automaticPublicationAllowed: false,
    reason:
      source.publicationMode === "review-only"
        ? "Candidate changes require official confirmation and human review."
        : "Existing updater safety gates decide publication; this audit never publishes data.",
  };
}
