# Borderly Data v8 — Territory Safety

> Исторический документ для релиза v8. Указанный ниже backlog закрыт в v17;
> актуальный результат находится в `TERRITORY_AUDIT_V17.md`.

## Goal

Data v8 extends the v7 accuracy-first pipeline to every destination outside the
199-destination Passport Index core. These 49 destinations may have their own
immigration law, a parent-country linkage, a permit system, or a composite ISO
code that cannot safely be reduced to an ordinary visa label.

The rule is conservative: a low-confidence extended feed may not silently refresh
an already-published non-core destination. If Borderly cannot represent a regime
accurately, the database uses a safety status instead of inventing `visa free` or
`visa required`.

## Territory registry

`territory_audit_registry.json` covers all 49 non-core destinations and assigns one
of four policies:

- `mirror-parent-category` — 10 destinations with a certified parent visa/category
  linkage. Only the visa/authorization category is mirrored; local entry conditions
  can still differ.
- `shared-official-list` — 4 Dutch-Caribbean destinations resolved from the
  Government of the Netherlands visa-exemption list plus destination exceptions.
- `fixed-status` — 10 destinations whose entry model is explicitly represented or
  conservatively classified.
- `freeze-dedicated` — 25 destinations kept frozen until a dedicated government-
  source audit is completed.

Registry coverage must remain exactly 49/49. A missing or duplicate non-core
registry entry fails validation.

## New safety statuses

Two data-layer statuses are introduced:

- `special permit` — the destination requires a permit/approval rather than an
  ordinary nationality-based visa classification.
- `mixed requirements` — the ISO destination or access route cannot safely be
  represented by one ordinary visa status.

The current Android parser treats unknown status strings as `NO_DATA`. Therefore a
current app build will fail safely for these statuses rather than showing an
incorrect visa label. A later Android UI patch can add dedicated user-facing labels.

## Certified/fixed examples in v8

- Pitcairn: `visa on arrival`, 14 days for the short-term visitor regime.
- British Indian Ocean Territory: `special permit`.
- South Georgia: `special permit`.
- Heard Island and McDonald Islands: `special permit`.
- Tokelau: `special permit`.
- Saint Helena / Ascension / Tristan da Cunha: `mixed requirements` because the
  combined ISO destination contains different entry systems.
- Svalbard and Jan Mayen: `mixed requirements` because one ordinary visa label is
  unsafe for the combined ISO destination and transit context.

## Automatic-update rules

`freezeExistingNonCoreDestinations=true` means the extended source may not change
an existing non-core category **or stay length** during scheduled updates. This is
stricter than the core Passport Index policy, where same-category day changes may
still be accepted.

The GitHub Actions pipeline now runs:

`published DB -> Data v8 audit -> territory audit -> source update -> official rules -> candidate audit -> validator -> territory re-audit -> publish`

Quality artifacts include `territory_audit_report.json`.

## Remaining backlog after v8

25 destinations remain intentionally frozen pending dedicated official-source
review:

AS, BM, VG, KY, YT, CK, FK, AX, GF, PF, GI, GP, GU, MQ, MS, NC, NU, MP, RE,
BL, AI, MF, PM, TC, WF.

This is not treated as certified data. The freeze prevents the lower-confidence
extended source from making the backlog worse while each destination is audited.

## Verification

Run locally before publishing:

```bash
node validate_visa_data.mjs
node audit_data_quality.mjs
node audit_territories.mjs
node test_territory_safety.mjs
```
