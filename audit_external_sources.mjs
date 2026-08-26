import fs from "node:fs";
import path from "node:path";
import {
  ageInDays,
  candidateDecision,
  compareCandidateDataset,
  freshnessState,
  findDatasetConflicts,
  normalizeCandidateDataset,
  parseCandidateDataset,
  sha256,
  validateDatasetThresholds,
} from "./external_source_contract.mjs";

const REGISTRY_FILE = "external_source_registry.json";
const BASELINE_FILE = "passport_index_source.json";
const SNAPSHOT_METADATA_FILE = "visa_requirements.json";
const DIFF_REPORT_FILE = "external_dataset_diff.json";
const FRESHNESS_REPORT_FILE = "source_freshness_report.json";
const RESULT_FILE = "external_source_result.txt";
const TIMEOUT_MS = 30000;
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;

function jsonText(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function githubHeaders(accept) {
  const headers = {
    accept,
    "user-agent":
      "BorderlyDataMonitor/1.0 (+https://github.com/shpak7194-gif/borderly-data)",
    "x-github-api-version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function fetchWithRetry(url, accept) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: githubHeaders(accept),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_DOWNLOAD_BYTES) {
        throw new Error(`response is too large (${contentLength} bytes)`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_DOWNLOAD_BYTES) {
        throw new Error(`response is too large (${buffer.length} bytes)`);
      }
      return {
        body: buffer.toString("utf8"),
        finalUrl: response.url,
        bytes: buffer.length,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    } catch (error) {
      lastError = error;
      if (attempt === 2 || error?.retryable === false) break;
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
  throw lastError;
}

async function fetchCommitMetadata(source) {
  try {
    const response = await fetchWithRetry(
      source.metadataUrl,
      "application/vnd.github+json"
    );
    const payload = JSON.parse(response.body);
    return {
      sourceCommitSha: payload.sha ?? null,
      sourceCommitAt:
        payload.commit?.committer?.date ?? payload.commit?.author?.date ?? null,
      metadataState: "available",
    };
  } catch (error) {
    return {
      sourceCommitSha: null,
      sourceCommitAt: null,
      metadataState: "unavailable",
      metadataError: error?.message ?? String(error),
    };
  }
}

async function auditSource(source, baseline, registry, checkedAt) {
  const metadataPromise = fetchCommitMetadata(source);
  try {
    const response = await fetchWithRetry(
      source.dataUrl,
      source.format.endsWith("csv")
        ? "text/csv,text/plain;q=0.9,*/*;q=0.8"
        : "application/json,text/plain;q=0.9,*/*;q=0.8"
    );
    const dataset = parseCandidateDataset(response.body, source.format);
    const validation = validateDatasetThresholds(dataset, source);
    const metadata = await metadataPromise;
    const sourceAgeDays = ageInDays(metadata.sourceCommitAt, new Date(checkedAt));
    const freshness = freshnessState(sourceAgeDays, registry.freshnessPolicy);

    if (!validation.ok) {
      return {
        id: source.id,
        label: source.label,
        role: source.role,
        sourceFamily: source.sourceFamily,
        publicationMode: source.publicationMode,
        state: "invalid",
        automaticPublicationAllowed: false,
        sourceObservedAt: checkedAt,
        sourceContentDate: null,
        sourceAgeDays,
        freshness,
        dataSha256: sha256(response.body),
        bytes: response.bytes,
        validation,
        ...metadata,
      };
    }

    const diff = compareCandidateDataset(baseline, dataset);
    const decision = candidateDecision(diff, source);
    return {
      id: source.id,
      label: source.label,
      role: source.role,
      sourceFamily: source.sourceFamily,
      publicationMode: source.publicationMode,
      state: decision.state,
      automaticPublicationAllowed: decision.automaticPublicationAllowed,
      decisionReason: decision.reason,
      sourceObservedAt: checkedAt,
      sourceContentDate: null,
      sourceAgeDays,
      freshness,
      sourceUrl: source.dataUrl,
      finalUrl: response.finalUrl,
      dataSha256: sha256(response.body),
      bytes: response.bytes,
      etag: response.etag,
      lastModified: response.lastModified,
      validation,
      diff,
      _dataset: dataset,
      ...metadata,
    };
  } catch (error) {
    const metadata = await metadataPromise;
    return {
      id: source.id,
      label: source.label,
      role: source.role,
      sourceFamily: source.sourceFamily,
      publicationMode: source.publicationMode,
      state: "unavailable",
      automaticPublicationAllowed: false,
      decisionReason: "The last known good dataset remains active.",
      sourceObservedAt: checkedAt,
      sourceContentDate: null,
      sourceAgeDays: ageInDays(metadata.sourceCommitAt, new Date(checkedAt)),
      freshness: freshnessState(
        ageInDays(metadata.sourceCommitAt, new Date(checkedAt)),
        registry.freshnessPolicy
      ),
      error: error?.message ?? String(error),
      ...metadata,
    };
  }
}

const registry = readJson(REGISTRY_FILE);
const baseline = normalizeCandidateDataset(readJson(BASELINE_FILE));
const database = readJson(SNAPSHOT_METADATA_FILE);
const approvedSnapshot = database.sourceSnapshots?.["passport-index-data"] ?? null;
const checkedAt = new Date().toISOString();

const results = await Promise.all(
  registry.sources.map((source) =>
    auditSource(source, baseline, registry, checkedAt)
  )
);
results.sort((left, right) => left.id.localeCompare(right.id));

const conflicts = findDatasetConflicts(
  results
    .filter((source) => source._dataset)
    .map((source) => ({ id: source.id, dataset: source._dataset }))
);
for (const source of results) delete source._dataset;

const reviewRequired = results.filter((source) => source.state === "review-required");
const unavailable = results.filter((source) => source.state === "unavailable");
const invalid = results.filter((source) => source.state === "invalid");
const stale = results.filter((source) =>
  ["warning", "critical", "future-date", "unknown"].includes(source.freshness)
);
const overallState = invalid.length > 0
  ? "invalid-source"
  : unavailable.length > 0
    ? "source-unavailable"
    : reviewRequired.length > 0
      ? "review-required"
      : stale.length > 0
        ? "freshness-warning"
        : "healthy";

const diffReport = {
  schemaVersion: 1,
  checkedAt,
  scope: registry.checkedDataScope,
  overallState,
  automaticPublicationAllowed: false,
  lastKnownGoodRetained: true,
  baseline: {
    file: BASELINE_FILE,
    snapshotUpdated: approvedSnapshot?.updated ?? database.updated ?? null,
    snapshotSha256: approvedSnapshot?.sha256 ?? null,
    sourceRepository: approvedSnapshot?.sourceRepository ?? null,
  },
  sourceFamilyPolicy: {
    sameFamilyIsIndependentCorroboration:
      registry.publicationPolicy.sameSourceFamilyIsIndependentCorroboration,
    note:
      "All configured public datasets are PassportIndex.org derivatives and do not constitute independent corroboration.",
  },
  summary: {
    sourceCount: results.length,
    unchangedSourceCount: results.filter((source) => source.state === "unchanged").length,
    reviewRequiredSourceCount: reviewRequired.length,
    unavailableSourceCount: unavailable.length,
    invalidSourceCount: invalid.length,
    sourceConflictCount: conflicts.conflictCount,
  },
  conflicts: {
    sourceFamilyIndependent: false,
    ...conflicts,
  },
  sources: results,
};

const freshnessReport = {
  schemaVersion: 1,
  checkedAt,
  policy: registry.freshnessPolicy,
  staleSourceCount: stale.length,
  sources: results.map((source) => ({
    id: source.id,
    label: source.label,
    role: source.role,
    sourceObservedAt: source.sourceObservedAt,
    sourceContentDate: source.sourceContentDate,
    sourceCommitSha: source.sourceCommitSha,
    sourceCommitAt: source.sourceCommitAt,
    sourceAgeDays: source.sourceAgeDays,
    freshness: source.freshness,
    metadataState: source.metadataState,
    ...(source.metadataError ? { metadataError: source.metadataError } : {}),
  })),
};

fs.writeFileSync(DIFF_REPORT_FILE, jsonText(diffReport));
fs.writeFileSync(FRESHNESS_REPORT_FILE, jsonText(freshnessReport));
fs.writeFileSync(RESULT_FILE, `${overallState}\n`);

console.log(
  `External source audit: ${overallState}; ` +
    `${reviewRequired.length} review, ${unavailable.length} unavailable, ` +
    `${invalid.length} invalid, ${stale.length} freshness warnings.`
);
