import fs from "node:fs";
import path from "node:path";
import {
  assessOfficialSource,
  challengeReason,
  normalizeOfficialBody,
  normalizedSha256,
} from "./official_source_contract.mjs";

const REGISTRY_FILE = "official_destination_sources.json";
const BASELINE_FILE = "official_source_fingerprints.json";
const REPORT_FILE = "official_source_review.json";
const RESULT_FILE = "official_source_result.txt";
const TIMEOUT_MS = 25000;
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;

function jsonText(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

async function fetchUrl(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "accept-language": "en;q=0.9",
      "user-agent":
        "BorderlyOfficialSourceMonitor/1.0 (+https://github.com/shpak7194-gif/borderly-data)",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredBytes = Number(response.headers.get("content-length") ?? 0);
  if (declaredBytes > MAX_DOWNLOAD_BYTES) {
    throw new Error(`response is too large (${declaredBytes} bytes)`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`response is too large (${buffer.length} bytes)`);
  }
  if (buffer.length < 150) throw new Error(`response is too small (${buffer.length} bytes)`);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "text/plain";
  const normalizedText = normalizeOfficialBody(buffer.toString("utf8"), contentType);
  const challenge = challengeReason(normalizedText);
  if (challenge) {
    return {
      state: "blocked",
      error: `official site returned ${challenge}; no bypass was attempted`,
      finalUrl: response.url,
      bytes: buffer.length,
      contentType,
    };
  }
  if (normalizedText.length < 100) {
    throw new Error(`normalized response is too small (${normalizedText.length} characters)`);
  }
  return {
    state: "reachable",
    finalUrl: response.url,
    bytes: buffer.length,
    contentType,
    normalizedText,
    normalizedSha256: normalizedSha256(normalizedText),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}

async function fetchFirstAvailable(source) {
  const attempts = [];
  for (const url of source.urls) {
    try {
      const fetched = await fetchUrl(url);
      attempts.push({ url, state: fetched.state, ...(fetched.error ? { error: fetched.error } : {}) });
      if (fetched.state === "reachable") return { ...fetched, requestedUrl: url, attempts };
      if (fetched.state === "blocked") return { ...fetched, requestedUrl: url, attempts };
    } catch (error) {
      attempts.push({ url, state: "unavailable", error: error?.message ?? String(error) });
    }
  }
  return {
    state: "unavailable",
    error: attempts.map((attempt) => `${attempt.url}: ${attempt.error}`).join("; "),
    attempts,
  };
}

const registry = readJson(REGISTRY_FILE);
const previous = readJson(BASELINE_FILE);
const previousById = new Map(
  (previous.sources ?? []).map((source) => [source.id, source])
);
const checkedAt = new Date().toISOString();

const fetchedSources = await Promise.all(
  registry.sources.map(async (source) => ({
    source,
    fetched: await fetchFirstAvailable(source),
  }))
);

let results = fetchedSources.map(({ source, fetched }) => {
  const assessment = assessOfficialSource({
    source,
    fetched,
    baseline: previousById.get(source.id),
  });
  return {
    id: source.id,
    label: source.label,
    authority: source.authority,
    destinationIso2: source.destinationIso2,
    sourcePriority: source.sourcePriority,
    checkedAt,
    state: assessment.state,
    reviewRequired: assessment.reviewRequired,
    requestedUrl: fetched.requestedUrl ?? source.urls[0],
    finalUrl: fetched.finalUrl ?? null,
    contentType: fetched.contentType ?? null,
    bytes: fetched.bytes ?? null,
    normalizedSha256: fetched.normalizedSha256 ?? null,
    etag: fetched.etag ?? null,
    lastModified: fetched.lastModified ?? null,
    attempts: fetched.attempts,
    ...(assessment.error ? { error: assessment.error } : {}),
    ...(assessment.missingMarkerGroups
      ? { missingMarkerGroups: assessment.missingMarkerGroups }
      : {}),
    ...(assessment.previousSha256
      ? {
          previousSha256: assessment.previousSha256,
          previousFinalUrl: assessment.previousFinalUrl,
        }
      : {}),
  };
});

const acceptCurrent = process.argv.includes("--accept-current");
if (acceptCurrent) {
  const nextFingerprints = [];
  const fetchedById = new Map(fetchedSources.map((item) => [item.source.id, item]));
  for (const source of registry.sources) {
    const item = fetchedById.get(source.id);
    const result = results.find((candidate) => candidate.id === source.id);
    if (
      item?.fetched.state === "reachable" &&
      !["invalid-content"].includes(result?.state)
    ) {
      nextFingerprints.push({
        id: source.id,
        requestedUrl: item.fetched.requestedUrl,
        finalUrl: item.fetched.finalUrl,
        contentType: item.fetched.contentType,
        bytes: item.fetched.bytes,
        normalizedSha256: item.fetched.normalizedSha256,
        acceptedAt: checkedAt,
      });
      result.state = "accepted";
      result.reviewRequired = false;
    } else if (previousById.has(source.id)) {
      nextFingerprints.push(previousById.get(source.id));
    }
  }
  nextFingerprints.sort((left, right) => left.id.localeCompare(right.id));
  fs.writeFileSync(
    BASELINE_FILE,
    jsonText({
      schemaVersion: 1,
      acceptedAt: checkedAt,
      sources: nextFingerprints,
    })
  );
}

results.sort((left, right) => left.id.localeCompare(right.id));
const changed = results.filter((source) => source.state === "changed");
const baselineMissing = results.filter((source) => source.state === "baseline-missing");
const invalid = results.filter((source) => source.state === "invalid-content");
const unavailable = results.filter((source) =>
  ["unavailable", "blocked"].includes(source.state)
);
const reviewRequired = results.filter((source) => source.reviewRequired);
const overallState = invalid.length > 0 || changed.length > 0 || baselineMissing.length > 0
  ? "review-required"
  : unavailable.length > 0
    ? "source-unavailable"
    : "healthy";
const coveredDestinations = new Set(results.flatMap((source) => source.destinationIso2));

const report = {
  schemaVersion: 1,
  checkedAt,
  scope: registry.scope,
  interpretationPolicy: registry.interpretationPolicy,
  overallState,
  automaticPublicationAllowed: false,
  lastKnownGoodRetained: true,
  acceptedCurrentFingerprints: acceptCurrent,
  summary: {
    sourceCount: results.length,
    coveredDestinationCount: coveredDestinations.size,
    changedSourceCount: changed.length,
    baselineMissingSourceCount: baselineMissing.length,
    invalidSourceCount: invalid.length,
    unavailableSourceCount: unavailable.length,
    reviewRequiredSourceCount: reviewRequired.length,
  },
  sources: results,
};

fs.writeFileSync(REPORT_FILE, jsonText(report));
fs.writeFileSync(RESULT_FILE, `${overallState}\n`);
console.log(
  `Official source audit: ${overallState}; ${results.length} sources, ` +
    `${coveredDestinations.size} destinations, ${reviewRequired.length} require review.`
);
