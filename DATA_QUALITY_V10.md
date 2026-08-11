# Borderly Data v10 — visa status + entry formalities

Data v10 separates the primary visa category from non-visa entry formalities.

## Invariant

`visa_requirements.json` remains the only source for map color and visa category.
`entry_requirements.json` may only add verified travel formalities and is structurally forbidden from redefining a visa status or stay length.

## Initial verified formalities

- Russia → Malaysia: MDAC, while the visa status remains `visa free`.
- Russia → China: Arrival Card, while the visa status remains `visa free`.
- United Arab Emirates → Russia: ruID pre-entry declaration, while the visa status is corrected to `visa free` for up to 90 days.

The initial file is deliberately small. Borderly prefers no additional-formality record over an unverified one.

## Safety checks

GitHub Actions runs:

- `validate_entry_requirements.mjs`
- `test_entry_requirements_safety.mjs`

The validator checks schema, HTTPS sources, pair compatibility with the current visa database and rejects fields that could redefine the visa category from the entry-formality layer.
