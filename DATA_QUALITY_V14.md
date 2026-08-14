# Borderly Data v14 — exact-source contract

Data v14 removes the historical rule that accepted only stay-length updates
from Passport Index while quarantining category changes. That behavior caused
published statuses to drift from the named source.

## Publication rules

1. `passport_index_source.json` is the exact canonical source snapshot used to
   build the core matrix.
2. Every core rule without a complete official source must equal that snapshot
   in both category and number of days.
3. A source value of `no admission` is stored as the single canonical Borderly
   category `entry restricted`; all other Passport Index categories map 1:1.
4. Only a rule with `sourceType=official`, an HTTPS source URL, source name and
   verification date may override the snapshot.
5. Freedom of movement remains a closed official registry and is never inferred
   from a visa-free source rule.
6. Arrival cards, pre-travel registrations, health/customs declarations and
   similar formalities live only in `entry_requirements.json`; they cannot
   produce `eta`, `e-visa` or another map status.
7. Certified territory mirrors are recalculated when their parent core rule
   changes. Pending non-core territories remain frozen and visible as audit
   warnings.

## Automated checks

`validate_passport_index_exactness.mjs` verifies the source file hash, size,
shape, status vocabulary, database/manifest metadata and all core pair values.
`test_update_pipeline.mjs` proves both an atomic no-change run and automatic
publication of a real source category change. The ordinary safety budget still
stops suspicious mass changes before publication.

The scheduled workflow checks only official pages registered in Borderly's
policy/watch files. It does not claim universal automatic monitoring of every
government website.
