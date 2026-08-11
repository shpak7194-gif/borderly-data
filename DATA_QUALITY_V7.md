# Borderly Data v7

## Goal

Data v7 changes the updater from a "latest feed wins" model to an accuracy-first
resolver. GitHub Pages remains the delivery channel, but a rule cannot be silently
reclassified by a lower-confidence source.

## Source priority

1. Active official rule policy.
2. Official restriction or mobility watch.
3. Verified manual/official override already stored in the database.
4. Passport Index Data for `passport-index-core` destinations.
5. Extended 227-destination source for extended-only destinations.
6. Territory derivation, only during an explicitly reviewed migration.

The extended source no longer owns categories for `passport-index-core` destinations.

## Category changes

For ordinary general-source updates:

- same category + changed stay length: may update automatically;
- changed visa category: quarantined in `data_quality_review.json`;
- a quarantined category does not replace the published Borderly rule;
- a blocked candidate is preserved as `visa_requirements.candidate.json` in the
  GitHub Actions quality artifact.

This deliberately prefers delayed review over publishing a potentially wrong visa
requirement.

## Freedom of movement

`freedom` is a closed category. Only pairs in `freedom_registry.json` may use it.
A source saying only "without a visa" is not sufficient.

As part of the v7 migration, Russia → Tajikistan was corrected from `freedom` to
`visa free`. The current freedom registry contains only the reciprocal Russia ↔
Belarus special mobility pair.

## Regressions

`regression_rules.json` contains known-good edge cases that may not regress during a
future import. The initial v7 set includes:

- UAE → Gibraltar = visa free, 90-day short-stay limit;
- Russia → Tajikistan = visa free, not freedom of movement;
- Taiwan → Moldova must not return to a closed-entry category.

## Current certification backlog

Data v7 Core installs the guardrails but does **not** claim that every historical
record is already officially certified.

Snapshot after the v7 migration (2026-08-11):

- 199 passport rows;
- 248 destinations;
- 27 `extended-227` destinations;
- 3 `extended-fw-split` destinations;
- 19 `derived-territory` destinations;
- therefore all 49 destinations outside the 199-destination passport-index core need
  a dedicated territory audit;
- 438 historical `entry restricted` records still lack dedicated authoritative source
  metadata and need review.

These are audit targets, not automatically declared errors. Scheduled updates are now
prevented from silently making this risk surface larger.

## Files

- `data_quality.mjs` — shared quality checks and candidate comparison;
- `audit_data_quality.mjs` — standalone current-database audit;
- `data_quality_policy.json` — thresholds and automatic-change policy;
- `freedom_registry.json` — closed allow-list for freedom of movement;
- `regression_rules.json` — known-good protected pairs;
- `official_rule_policies.json` — authoritative pair-specific rules;
- `data_quality_review.json` — generated review queue (GitHub Actions artifact, not a
  published database file).
