export const PROVENANCE_SCHEMA_VERSION = 1;

export const BORDERLY_DATA_REPOSITORY =
  "https://github.com/shpak7194-gif/borderly-data";

export const VISA_SOURCE_REGISTRY = [
  {
    id: "passport-index-data",
    type: "dataset",
    name: "Passport Index Data",
    url: "https://github.com/imorte/passport-index-data",
    description:
      "Основной открытый набор визовых статусов и сроков пребывания. " +
      "Это источник происхождения данных, а не индивидуальное подтверждение государственного органа.",
    license: "MIT",
  },
  {
    id: "kaggle-extended",
    type: "dataset",
    name: "Global Passport Power Rankings & Visa Requirements",
    url: "https://www.kaggle.com/datasets/ngshiheng/henley-passport-index-visa-requirements",
    description:
      "Дополнительный сравнительный набор для направлений, отсутствующих в основной матрице. " +
      "Изменения категорий из этого источника проходят карантин Borderly.",
    license: "CC BY-NC 4.0",
  },
  {
    id: "borderly-territory-registry",
    type: "derived",
    name: "Реестр территориальных правил Borderly",
    url: `${BORDERLY_DATA_REPOSITORY}/blob/main/territory_derivations.json`,
    description:
      "Производное правило для территории: статус наследуется от управляющей юрисдикции " +
      "или задаётся отдельной проверяемой политикой.",
  },
];

const SOURCE_ID_BY_DESTINATION_KIND = {
  "passport-index-core": "passport-index-data",
  "extended-227": "kaggle-extended",
  "extended-fw-split": "kaggle-extended",
  "derived-territory": "borderly-territory-registry",
};

export function sourceIdForDestination(destination) {
  const sourceId = SOURCE_ID_BY_DESTINATION_KIND[destination?.sourceKind];
  if (!sourceId) {
    throw new Error(
      `No provenance source for destination ${destination?.iso2 ?? "unknown"} ` +
        `(${destination?.sourceKind ?? "missing sourceKind"})`
    );
  }
  return sourceId;
}

export function buildVisaProvenance(destinationManifest) {
  const destinations = destinationManifest?.destinations ?? [];
  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    destinationSourceIds: Object.fromEntries(
      destinations.map((destination) => [
        String(destination.numeric),
        sourceIdForDestination(destination),
      ])
    ),
  };
}

export function normalizeExplicitRuleSource(rule) {
  if (!rule || typeof rule !== "object") return rule;
  const hasSource = Boolean(rule.source && rule.sourceUrl);
  if (hasSource && !rule.sourceType) {
    rule.sourceType = "official";
  }
  return rule;
}
