# Borderly data attribution

## Passport Index Data

- Project: `imorte/passport-index-data`
- URL: https://github.com/imorte/passport-index-data
- Use in Borderly: 199 passport rows, peer-destination rules and stay lengths.

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

## Derived ISO territories

The 19 destinations absent from the 227-destination layer are declared in
`territory_derivations.json`. They inherit the closest governing entry regime
or use an explicit fixed classification. This makes the derivation reviewable
and prevents hidden per-passport guesses.
