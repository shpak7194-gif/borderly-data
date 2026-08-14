# Borderly Data v17 — official-territory checkpoint

Date: 2026-08-14

## Result

- Matrix: 199 passports × 248 destinations = 49,153 rules.
- Passport Index MIT core: 38,418 exact rules.
- Official core overrides: 984.
- Official territory matrices: 25 destinations and 4,975 verified rules.
- Pending territory audits: 0.
- Provenance: official 8,487; dataset 38,418; derived 2,248.
- Immutable release: `releases/visa_requirements_v17.json`.
- SHA-256: `9b7a4bb0c5c8de6a2e41e4977bd68097519e7dfe5168a958843224ded8fadef8`.

## Publication policy

1. Only `freedom` and `visa free` score in ranking.
2. Arrival cards and travel declarations remain separate from visa status.
3. Conditional exemptions based on a third-country visa or residence permit are
   shown as conditions and do not silently become `visa free`.
4. Official territory rules include a source URL and verification date.
5. A detected change on an official page creates a review artifact; it does not
   cause an unreviewed category change.
6. `validate_all.mjs` verifies taxonomy, Passport Index exactness, provenance,
   licenses, official matrices, immutable releases, SHA-256 and updater safety.

## Automated updates

The Passport Index core is mapped and updated exactly. Registered official pages
are monitored automatically. Because government pages are unstructured legal
documents, changed text is deliberately held for review before a status is
changed. This avoids treating an arrival form as an eTA, or an electronic
application channel as an eVisa without legal support.

## Commercial-use boundary

The active publication pipeline uses the MIT-licensed Passport Index dataset and
registered official government material. It does not restore the former
non-commercial comparison layer. `validate_commercial_licenses.mjs` blocks its
reintroduction into an active release.
