import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  collectTerritoryPolicySources,
  loadTerritoryOfficialPolicies,
} from "./territory_policy_contract.mjs";

const BASELINE_FILE = "territory_source_fingerprints.json";
const CANDIDATE_FILE = "territory_source_watch_candidate.json";
const RESULT_FILE = "territory_source_watch_result.txt";
const TIMEOUT_MS = 25000;

function jsonText(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function normalizeBody(text, contentType) {
  let normalized = String(text).normalize("NFKC");
  if (contentType.includes("html")) {
    normalized = normalized
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, "\"");
  }
  return normalized
    // Some government templates print a live clock in otherwise static page
    // text. It is presentation noise, not an immigration-rule change.
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, "[clock]")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

async function fetchSource(url) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "user-agent": "BorderlyDataSourceMonitor/1.0 (+https://github.com/shpak7194-gif/borderly-data)",
      accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (new URL(response.url).hostname === "unblock.federalregister.gov") {
    throw new Error("official site returned an automated-access challenge");
  }
  if (buffer.length < 100) throw new Error(`response too small (${buffer.length} bytes)`);
  const normalized = contentType.includes("pdf")
    ? buffer.toString("base64")
    : normalizeBody(buffer.toString("utf8"), contentType);
  return {
    finalUrl: response.url,
    contentType: contentType.split(";")[0],
    bytes: buffer.length,
    normalizedSha256: sha256(normalized),
  };
}

const policyDatabase = loadTerritoryOfficialPolicies(process.cwd());
const registeredSources = collectTerritoryPolicySources(policyDatabase);

const checks = await Promise.all(
  registeredSources.map(async (source) => {
    try {
      return {
        ...source,
        state: "reachable",
        ...(await fetchSource(source.url)),
      };
    } catch (error) {
      return {
        ...source,
        state: "unavailable",
        error: error?.message ?? String(error),
      };
    }
  })
);
checks.sort((left, right) => left.url.localeCompare(right.url));

const unavailable = checks.filter((item) => item.state !== "reachable");
const previous = fs.existsSync(BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"))
  : null;
const previousByUrl = new Map(
  (previous?.sources ?? []).map((source) => [source.url, source])
);
const changed = checks.filter((source) => {
  if (source.state !== "reachable") return false;
  const baseline = previousByUrl.get(source.url);
  return (
    !baseline ||
    baseline.normalizedSha256 !== source.normalizedSha256 ||
    baseline.finalUrl !== source.finalUrl
  );
});

const candidate = {
  schemaVersion: 1,
  policyAuditDate: policyDatabase.auditedAt,
  sourceCount: checks.length,
  changedSourceCount: changed.length,
  unavailableSourceCount: unavailable.length,
  changedSources: changed.map((source) => source.url),
  unavailableSources: unavailable.map((source) => ({
    url: source.url,
    error: source.error,
  })),
  sources: checks,
};

const accept = process.argv.includes("--accept");
if (!previous || accept) {
  // Government sites frequently block automated clients. Keep verified
  // fingerprints for every source that is reachable now and preserve the
  // previous fingerprint for a temporarily unavailable source. This makes the
  // monitor useful without treating an HTTP block as a visa-policy change.
  const reachableByUrl = new Map(
    checks
      .filter((source) => source.state === "reachable")
      .map((source) => [source.url, source])
  );
  for (const source of previous?.sources ?? []) {
    if (!reachableByUrl.has(source.url)) reachableByUrl.set(source.url, source);
  }
  const baselineSources = [...reachableByUrl.values()].sort((left, right) =>
    left.url.localeCompare(right.url)
  );
  const baseline = {
    schemaVersion: 1,
    policyAuditDate: policyDatabase.auditedAt,
    sourceCount: baselineSources.length,
    sources: baselineSources,
  };
  fs.writeFileSync(BASELINE_FILE, jsonText(baseline));

  // The current fingerprints have now become the reviewed baseline. Keep an
  // audit trail of what was accepted, while ensuring the report and GitHub
  // issue do not continue to present those pages as pending review.
  candidate.fingerprintAction = previous ? "accepted" : "initialized";
  candidate.acceptedSourceCount = changed.length;
  candidate.acceptedSources = [...candidate.changedSources];
  candidate.changedSourceCount = 0;
  candidate.changedSources = [];
  fs.writeFileSync(CANDIDATE_FILE, jsonText(candidate));

  const result = unavailable.length > 0
    ? (previous ? "accepted_partial" : "initialized_partial")
    : (previous ? "accepted" : "initialized");
  fs.writeFileSync(RESULT_FILE, `${result}\n`);
  console.log(
    `${previous ? "Accepted" : "Initialized"} ${baselineSources.length} official territory source fingerprints` +
      (unavailable.length > 0 ? `; ${unavailable.length} sources were unavailable.` : ".")
  );
  process.exit(0);
}

fs.writeFileSync(CANDIDATE_FILE, jsonText(candidate));

if (changed.length > 0) {
  fs.writeFileSync(RESULT_FILE, "review_required\n");
  console.error(
    `${changed.length} official territory sources changed. ` +
      "Review the candidate report before running this script with --accept."
  );
  process.exit(3);
}

if (unavailable.length > 0) {
  fs.writeFileSync(RESULT_FILE, "unavailable\n");
  console.warn(
    `${unavailable.length} official territory sources were unavailable; ` +
      "the approved visa matrix remains unchanged and the access limitation was recorded."
  );
  process.exit(0);
}

fs.writeFileSync(RESULT_FILE, "unchanged\n");
console.log(`${checks.length} official territory source fingerprints are unchanged.`);
