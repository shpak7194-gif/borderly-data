# Borderly data attribution

## Passport Index Data

- Project: `imorte/passport-index-data`
- URL: https://github.com/imorte/passport-index-data
- Use in Borderly: 199 passport rows, peer-destination rules and stay lengths.
- Exact snapshot: `passport_index_source.json`; its SHA-256 and byte count are
  pinned in both `visa_requirements.json` and `version.json`.

## Commercial-source policy

Data v17 contains no active non-commercial comparison layer. Destinations
outside the 199-destination MIT core are controlled by
`territory_audit_registry.json`. The 25 destinations that previously lacked a
dedicated policy are now controlled by ordinary-passport tourism matrices in
`territory_official_policies.json`.

## Review-only public candidates

The monitoring workflow also downloads these public candidates:

- `A-contresens/passport-index-data`;
- `visualpharm/visa-free-dataset`.

They are used only to detect differences from the approved snapshot. Their
rules are not copied into a published Borderly release by the audit, and two
PassportIndex.org derivatives are not treated as independent corroboration.
The repository license for a scraper or derivative does not by itself prove
rights in the underlying travel database; Borderly therefore uses candidate
changes as leads for official-source review rather than as automatic legal
truth.

## Official protected rules

Borderly separately checks the official sources listed in
`official_entry_watches.json`, `special_mobility_watches.json`, and the Danish
Immigration Service pages used for Greenland. Confirmed official rules take
priority over general feeds and are preserved when a source is unavailable.
Visa data v17 stores those links on the affected passport/destination rules so
the Android app can label them as rule-specific official confirmation.

`official_destination_sources.json` adds fingerprint-only monitoring for
primary destination-authority pages. A fingerprint change is an audit signal,
not a rule. It cannot automatically turn an arrival declaration into eTA,
change a stay duration, or publish a new visa category.

## Exact official evidence

`official_rule_evidence.json` is a separate evidence layer for individual
passport/destination rules. A verified entry contains the government authority,
official HTTPS URL, short exact excerpts in the source language, retrieval date,
traveler-action classification and a SHA-256 of the normalized excerpts.

An official URL stored on a published rule is provenance metadata. It becomes
exact rule evidence only when the matching entry passes
`validate_official_evidence.mjs`. Public datasets, search snippets, blogs and
news articles can initiate a review but can never create a verified evidence
entry. Advice from the passport-issuing country may cross-check a rule but is
not accepted as its sole primary evidence.

Evidence freshness is reported separately from the policy's effective date.
Evidence older than 90 days is marked stale and sent for review; the last known
good visa rule is retained. See `OFFICIAL_EVIDENCE_METHODOLOGY.md` for the full
classification and review contract.

## Non-core ISO territories

All 49 destinations outside the Passport Index core are declared in
`territory_audit_registry.json`. Certified entries use an official status matrix,
an official shared list, a reviewed parent-category relationship or a fixed safety
classification. The audit currently has 25 official matrices and zero pending
destinations.

`check_territory_sources.mjs` records fingerprints of the registered official
pages. A changed page creates a review artifact and leaves the last verified
status unchanged. This is intentional: a generic text change cannot safely be
reclassified automatically as eTA, eVisa, visa on arrival or an arrival card.

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
