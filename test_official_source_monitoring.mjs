import assert from "node:assert/strict";
import {
  assessOfficialSource,
  challengeReason,
  evaluateMarkerGroups,
  evaluatePolicyWindow,
  normalizeOfficialBody,
  normalizedSha256,
} from "./official_source_contract.mjs";

const first = normalizeOfficialBody(
  "<html><style>.x{}</style><body>Visa Policy 10:20:30 <b>90 days</b></body></html>"
);
const second = normalizeOfficialBody(
  "<html><body> Visa Policy 11:22:33 90&nbsp;days <script>noise()</script></body></html>"
);
assert.equal(first, second, "Template clocks and scripts must not create false changes");
assert.equal(challengeReason("please verify that you are human"), "human-verification");
assert.equal(
  evaluateMarkerGroups(first, [["visa policy"], ["90-day", "90 days"]]).ok,
  true
);

const source = {
  requiredMarkerGroups: [["visa policy"], ["90 days"]],
};
const fetched = {
  state: "reachable",
  normalizedText: first,
  normalizedSha256: normalizedSha256(first),
  finalUrl: "https://example.gov/visa",
};
assert.equal(
  assessOfficialSource({ source, fetched, baseline: null }).state,
  "baseline-missing"
);
assert.deepEqual(
  assessOfficialSource({
    source,
    fetched,
    baseline: {
      normalizedSha256: fetched.normalizedSha256,
      finalUrl: fetched.finalUrl,
    },
  }),
  { state: "unchanged", reviewRequired: false }
);
assert.equal(
  assessOfficialSource({
    source,
    fetched: { ...fetched, normalizedSha256: "a".repeat(64) },
    baseline: {
      normalizedSha256: fetched.normalizedSha256,
      finalUrl: fetched.finalUrl,
    },
  }).state,
  "changed"
);
assert.equal(
  assessOfficialSource({
    source,
    fetched: { state: "unavailable", error: "HTTP 503" },
    baseline: {
      normalizedSha256: fetched.normalizedSha256,
      finalUrl: fetched.finalUrl,
    },
  }).reviewRequired,
  true,
  "Unavailable official pages must preserve the last known good state and request review"
);
assert.equal(
  assessOfficialSource({
    source,
    fetched: { ...fetched, normalizedText: "unrelated page" },
    baseline: null,
  }).state,
  "invalid-content"
);

assert.deepEqual(evaluatePolicyWindow({ validFrom: "2026-09-01" }, "2026-08-26"), {
  state: "scheduled",
  boundary: "2026-09-01",
});
assert.deepEqual(evaluatePolicyWindow({ validUntil: "2026-08-25" }, "2026-08-26"), {
  state: "expired",
  boundary: "2026-08-25",
});
assert.equal(
  evaluatePolicyWindow(
    { validFrom: "2026-08-26", validUntil: "2026-08-26" },
    "2026-08-26"
  ).state,
  "active",
  "Policy boundaries are inclusive"
);

console.log("Official source monitoring safety tests passed.");
