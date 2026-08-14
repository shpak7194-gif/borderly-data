# Borderly data attribution

## Passport Index Data

- Project: `imorte/passport-index-data`
- URL: https://github.com/imorte/passport-index-data
- Use in Borderly: 199 passport rows, peer-destination rules and stay lengths.
- Exact snapshot: `passport_index_source.json`; its SHA-256 and byte count are
  pinned in both `visa_requirements.json` and `version.json`.

## Commercial-source policy

Data v15 contains no active non-commercial comparison layer. Destinations
outside the 199-destination MIT core are controlled by
`territory_audit_registry.json`. If a dedicated official policy has not been
completed, Borderly publishes `no data` rather than retaining a historical
secondary-source category.

## Official protected rules

Borderly separately checks the official sources listed in
`official_entry_watches.json`, `special_mobility_watches.json`, and the Danish
Immigration Service pages used for Greenland. Confirmed official rules take
priority over general feeds and are preserved when a source is unavailable.
Visa data v15 stores those links on the affected passport/destination rules so
the Android app can label them as rule-specific official confirmation.

## Non-core ISO territories

All 49 destinations outside the Passport Index core are declared in
`territory_audit_registry.json`. Certified entries use an official shared list,
a reviewed parent-category relationship or a fixed safety classification.
Pending entries remain `no data` except for rule-specific official evidence.

## Provenance shown in the app

Every published rule resolves to a source. A rule-level official URL is shown
as confirmation for that passport/destination pair. Dataset and derivation URLs
are labelled as provenance only; they are not presented as individual proof
from a government authority.

## Status mapping contract

Passport Index values are mapped without reinterpretation: `visa free` stays
visa-free, `eta` becomes the eTA/ESTA category, `visa on arrival` stays visa on
arrival, `e-visa` stays eVisa, `visa required` stays visa required, and
`no admission` becomes Borderly's canonical `entry restricted`. Arrival cards
and travel declarations are separate non-visa records and never participate in
this mapping.
