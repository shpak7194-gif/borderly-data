# Borderly data attribution

## Passport Index Data

- Project: `imorte/passport-index-data`
- URL: https://github.com/imorte/passport-index-data
- Use in Borderly: 199 passport rows, peer-destination rules and stay lengths.
- Exact snapshot: `passport_index_source.json`; its SHA-256 and byte count are
  pinned in both `visa_requirements.json` and `version.json`.

## Global Passport Power Rankings & Visa Requirements

- Dataset author: Jerry Ng (`ngshiheng` on Kaggle)
- URL: https://www.kaggle.com/datasets/ngshiheng/henley-passport-index-visa-requirements
- License: Creative Commons Attribution-NonCommercial 4.0 International
  (CC BY-NC 4.0)
- Use in Borderly: requirement categories for the 227-destination layer.

The CC BY-NC layer must be replaced or separately licensed before Borderly is
used commercially.

## Official protected rules

Borderly separately checks the official sources listed in
`official_entry_watches.json`, `special_mobility_watches.json`, and the Danish
Immigration Service pages used for Greenland. Confirmed official rules take
priority over general feeds and are preserved when a source is unavailable.
Visa data v14 stores those links on the affected passport/destination rules so
the Android app can label them as rule-specific official confirmation.

## Derived ISO territories

The 19 destinations absent from the 227-destination layer are declared in
`territory_derivations.json`. They inherit the closest governing entry regime
or use an explicit fixed classification. This makes the derivation reviewable
and prevents hidden per-passport guesses.

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
