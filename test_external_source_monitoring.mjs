import assert from "node:assert/strict";
import {
  candidateDecision,
  compareCandidateDataset,
  freshnessState,
  findDatasetConflicts,
  hasIndependentCorroboration,
  parseCandidateDataset,
  validateDatasetThresholds,
} from "./external_source_contract.mjs";

const csv = [
  "Passport,Destination,Requirement",
  "AA,AA,-1",
  "AA,BB,30",
  "BB,AA,eta",
  "BB,BB,-1",
].join("\n");
const parsedCsv = parseCandidateDataset(csv, "passport-index-tidy-iso2-csv");
assert.deepEqual(parsedCsv.AA.BB, { status: "visa free", days: 30 });
assert.deepEqual(parsedCsv.BB.AA, { status: "eta" });

assert.throws(
  () =>
    parseCandidateDataset(
      "Passport,Destination,Requirement\nAA,BB,arrival card\n",
      "passport-index-tidy-iso2-csv"
    ),
  /Unsupported Passport Index status/,
  "Arrival card must never be reclassified as ETA or another visa status"
);

const baseline = {
  AA: {
    BB: { status: "visa free", days: 30 },
    CC: { status: "visa required" },
    DD: { status: "eta" },
  },
};
const candidate = {
  AA: {
    BB: { status: "visa free", days: 60 },
    CC: { status: "e-visa" },
    EE: { status: "visa on arrival" },
  },
};
const diff = compareCandidateDataset(baseline, candidate);
assert.equal(diff.categoryChangeCount, 1);
assert.equal(diff.stayLengthChangeCount, 1);
assert.equal(diff.missingRuleCount, 1);
assert.equal(diff.extraRuleCount, 1);
assert.equal(candidateDecision(diff, { publicationMode: "review-only" }).automaticPublicationAllowed, false);

const incomplete = validateDatasetThresholds(parsedCsv, {
  minimumPassportCount: 199,
  minimumRuleCount: 39000,
});
assert.equal(incomplete.ok, false, "Incomplete upstream tables must be rejected");

const massBaseline = {};
const massCandidate = {};
const isoCodes = Array.from({ length: 30 }, (_, index) =>
  `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`
);
for (const passport of isoCodes) {
  massBaseline[passport] = {};
  massCandidate[passport] = {};
  for (const destination of isoCodes) {
    if (passport === destination) continue;
    massBaseline[passport][destination] = { status: "visa free" };
    massCandidate[passport][destination] = { status: "visa required" };
  }
}
const massDiff = compareCandidateDataset(massBaseline, massCandidate, 25);
assert.equal(massDiff.categoryChangeCount, 870);
assert.equal(massDiff.detailsTruncated, true);
assert.equal(candidateDecision(massDiff, { publicationMode: "review-only" }).state, "review-required");

const registry = {
  sources: [
    { id: "one", sourceFamily: "passportindex-org" },
    { id: "two", sourceFamily: "passportindex-org" },
    { id: "three", sourceFamily: "official-government" },
  ],
};
assert.equal(hasIndependentCorroboration(["one", "two"], registry), false);
assert.equal(hasIndependentCorroboration(["one", "three"], registry), true);

const conflicts = findDatasetConflicts([
  { id: "one", dataset: { AA: { BB: { status: "visa free", days: 30 } } } },
  { id: "two", dataset: { AA: { BB: { status: "e-visa" } } } },
]);
assert.equal(conflicts.conflictCount, 1);
assert.equal(conflicts.conflicts[0].passport, "AA");

assert.equal(freshnessState(3, { warningAfterDays: 14, criticalAfterDays: 45 }), "fresh");
assert.equal(freshnessState(20, { warningAfterDays: 14, criticalAfterDays: 45 }), "warning");
assert.equal(freshnessState(60, { warningAfterDays: 14, criticalAfterDays: 45 }), "critical");
assert.equal(freshnessState(-3, { warningAfterDays: 14, criticalAfterDays: 45 }), "future-date");

console.log("External source monitoring safety tests passed.");
