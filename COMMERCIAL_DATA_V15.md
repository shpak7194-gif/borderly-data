# Borderly Data v15 — commercial-source checkpoint

Date: 2026-08-14

## Result

The active Borderly release and scheduled workflow no longer download, publish
or depend on the former non-commercial comparison layer.

- Matrix: 199 passports × 248 destinations = 49,153 rules.
- Passport Index MIT core: 38,418 exact rules.
- Official core overrides: 984.
- Rule-specific official sources across the full matrix: 3,706.
- Territory-registry rules: 7,029.
- Unverified territory rules replaced with `no data`: 4,781.
- Rule-specific official exceptions retained inside pending territories: 194.

## Publication policy

1. Only `freedom` and `visa free` score in ranking.
2. `no data` never scores and is rendered as an unconfirmed grey category.
3. A pending territory can publish a real visa category only when that exact
   passport/destination rule has a complete official or corroborated source.
4. The arrival-card layer remains separate and cannot change the visa status.
5. `validate_commercial_licenses.mjs` blocks a release if an active
   non-commercial source, identifier or download step returns.

## Deployment compatibility

Data v15 uses taxonomy v2. Android builds with taxonomy v1 reject it safely and
keep their last compatible database. The updated Android project accepts
taxonomy v2 and includes data v15 as its offline fallback.

## Remaining accuracy backlog

Twenty-five non-core destinations still require dedicated official audits.
They remain visible, but unsupported pairs show `Нет подтверждённых данных`
instead of a guessed visa category.
