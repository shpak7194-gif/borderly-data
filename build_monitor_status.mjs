import fs from "node:fs";

const STATUS_FILE = "monitor_status.json";
const ISSUES_FILE = "monitor_issues.json";

function jsonText(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function readOptionalJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { parseError: error?.message ?? String(error) };
  }
}

function shortLines(items, render, limit = 12) {
  const lines = items.slice(0, limit).map(render);
  if (items.length > limit) lines.push(`- …ещё ${items.length - limit}`);
  return lines.join("\n");
}

function issue(key, title, body) {
  return {
    key,
    title: `[Borderly monitor:${key}] ${title}`,
    body,
  };
}

const checkedAt = new Date().toISOString();
const external = readOptionalJson("external_dataset_diff.json");
const freshness = readOptionalJson("source_freshness_report.json");
const official = readOptionalJson("official_source_review.json");
const officialEvidence = readOptionalJson("official_evidence_report.json");
const territory = readOptionalJson("territory_source_watch_candidate.json");
const updateOutcome = process.env.UPDATE_OUTCOME ?? "unknown";
const validationOutcome = process.env.VALIDATION_OUTCOME ?? "unknown";
const externalAuditOutcome = process.env.EXTERNAL_AUDIT_OUTCOME ?? "unknown";
const officialAuditOutcome = process.env.OFFICIAL_AUDIT_OUTCOME ?? "unknown";
const officialEvidenceOutcome = process.env.OFFICIAL_EVIDENCE_OUTCOME ?? "unknown";
const territoryAuditOutcome = process.env.TERRITORY_AUDIT_OUTCOME ?? "unknown";
const updateResult = fs.existsSync("update_result.txt")
  ? fs.readFileSync("update_result.txt", "utf8").trim()
  : "not-produced";
const issues = [];
const monitoringLimitations = [];

const failedAuditSteps = [
  ["external", externalAuditOutcome, external],
  ["official", officialAuditOutcome, official],
  ["official-evidence", officialEvidenceOutcome, officialEvidence],
  ["territory", territoryAuditOutcome, territory],
].filter(([, outcome, report]) => outcome !== "success" && !report);
if (failedAuditSteps.length > 0) {
  issues.push(
    issue(
      "monitor-audit-failure",
      "Сбой мониторинга источников",
      [
        "Один или несколько аудиторов не создали отчёт. Визовая база не должна меняться на основании этого запуска.",
        "",
        `Проверено: ${checkedAt}`,
        "",
        shortLines(failedAuditSteps, ([name, outcome]) => `- **${name}** — ${outcome}`),
        "",
        "Действие: открыть логи соответствующих шагов GitHub Actions и исправить ошибку парсера или конфигурации.",
      ].join("\n")
    )
  );
}

const externalReviewSources = (external?.sources ?? []).filter((source) =>
  ["review-required", "invalid"].includes(source.state)
);
if (externalReviewSources.length > 0) {
  issues.push(
    issue(
      "external-source-review",
      "Проверить изменения внешних наборов",
      [
        "Автоматическая публикация отключена. Рабочая база не заменена.",
        "",
        `Проверено: ${checkedAt}`,
        `Состояние: **${external?.overallState ?? "review-required"}**`,
        "",
        shortLines(externalReviewSources, (source) =>
          `- **${source.label}** — ${source.state}; ` +
          `категории: ${source.diff?.categoryChangeCount ?? 0}, ` +
          `сроки: ${source.diff?.stayLengthChangeCount ?? 0}, ` +
          `неполные сроки: ${source.diff?.stayLengthCoverageGapCount ?? 0}, ` +
          `пропуски: ${source.diff?.missingRuleCount ?? 0}`
        ),
        "",
        "Действие: изучить `external_dataset_diff.json`, подтвердить существенные изменения на официальном сайте страны назначения и оформить их в официальном policy/watch-реестре.",
      ].join("\n")
    )
  );
}

const unavailableExternalSources = (external?.sources ?? []).filter(
  (source) => source.state === "unavailable"
);
if (unavailableExternalSources.length > 0) {
  monitoringLimitations.push({
    key: "external-source-access",
    label: "Недоступны внешние наборы",
    sourceCount: unavailableExternalSources.length,
    sources: unavailableExternalSources.map((source) => ({
      id: source.id,
      label: source.label,
      state: source.state,
      error: source.error ?? null,
    })),
  });
}

if ((external?.conflicts?.conflictCount ?? 0) > 0) {
  issues.push(
    issue(
      "source-conflict",
      "Разобрать конфликт источников",
      [
        "Внешние наборы дают разные визовые значения для одних и тех же направлений. Они относятся к одному семейству и не подтверждают друг друга.",
        "",
        `Проверено: ${checkedAt}`,
        `Конфликтующих связок: **${external.conflicts.conflictCount}**`,
        "",
        shortLines(external.conflicts.conflicts ?? [], (conflict) =>
          `- **${conflict.passport} → ${conflict.destination}**: ` +
          `${conflict.conflictType === "stay-length" ? "срок" : "категория"}; ` +
          conflict.sources.map((source) =>
            `${source.id}=${source.rule.status}${Number.isInteger(source.rule.days) ? `/${source.rule.days}` : ""}`
          ).join(", ")
        ),
        "",
        "Действие: проверить связки по официальному источнику страны назначения. До подтверждения рабочая база не меняется.",
      ].join("\n")
    )
  );
}

const staleSources = (freshness?.sources ?? []).filter(
  (source) =>
    source.role === "active-snapshot" &&
    ["warning", "critical", "future-date", "unknown"].includes(source.freshness)
);
if (staleSources.length > 0) {
  issues.push(
    issue(
      "source-freshness",
      "Проверить свежесть источников",
      [
        "Активный набор, из которого собрана рабочая база, не имеет достаточно свежего подтверждённого коммита.",
        "",
        `Проверено: ${checkedAt}`,
        "",
        shortLines(staleSources, (source) =>
          `- **${source.label}** — ${source.freshness}, возраст: ${source.sourceAgeDays ?? "неизвестен"} дн., commit: ${source.sourceCommitSha ?? "нет"}`
        ),
        "",
        "Действие: проверить репозиторий и официальный источник. Старый возраст сам по себе не является доказательством изменения визового режима.",
      ].join("\n")
    )
  );
}

const officialReviewSources = (official?.sources ?? []).filter((source) =>
  ["changed", "baseline-missing", "invalid-content"].includes(source.state)
);
if (officialReviewSources.length > 0) {
  issues.push(
    issue(
      "official-source-review",
      "Проверить официальные страницы",
      [
        "Текст официальной страницы не интерпретировался автоматически; последняя рабочая визовая база сохранена.",
        "",
        `Проверено: ${checkedAt}`,
        `Состояние: **${official?.overallState ?? "review-required"}**`,
        "",
        shortLines(officialReviewSources, (source) =>
          `- **${source.label}** — ${source.state}${source.error ? ` (${source.error})` : ""}`
        ),
        "",
        "Действие: изучить `official_source_review.json`. После ручной проверки новых отпечатков запустить workflow вручную с `accept_official_fingerprints=true`. Это принимает только отпечаток страницы и не меняет визовый статус.",
      ].join("\n")
    )
  );
}

const unavailableOfficialSources = (official?.sources ?? []).filter((source) =>
  ["unavailable", "blocked"].includes(source.state)
);
if (unavailableOfficialSources.length > 0) {
  monitoringLimitations.push({
    key: "official-source-access",
    label: "Недоступны официальные страницы",
    sourceCount: unavailableOfficialSources.length,
    sources: unavailableOfficialSources.map((source) => ({
      id: source.id,
      label: source.label,
      state: source.state,
      error: source.error ?? null,
    })),
  });
}

const evidenceSummary = officialEvidence?.summary ?? {};
const missingPolicyEvidencePairCount =
  evidenceSummary.missingPolicyEvidencePairCount ?? 0;
const missingTerritoryPolicyCount = Math.max(
  0,
  (evidenceSummary.territoryPolicyCount ?? 0) -
    (evidenceSummary.verifiedTerritoryPolicyCount ?? 0)
);
const missingTerritoryMatrixEvidenceRuleCount =
  evidenceSummary.missingTerritoryMatrixEvidenceRuleCount ??
  Math.max(
    0,
    (evidenceSummary.territoryMatrixRuleCount ?? 0) -
      (evidenceSummary.verifiedTerritoryMatrixRuleCount ?? 0)
  );
const staleEvidenceCount = evidenceSummary.staleEvidenceCount ?? 0;
const unexpectedEvidenceState =
  officialEvidence?.overallState &&
  !["healthy", "coverage-in-progress", "stale-evidence"].includes(
    officialEvidence.overallState
  );
const evidenceActionRequired =
  missingPolicyEvidencePairCount > 0 ||
  missingTerritoryPolicyCount > 0 ||
  missingTerritoryMatrixEvidenceRuleCount > 0 ||
  staleEvidenceCount > 0 ||
  unexpectedEvidenceState;
if (evidenceActionRequired) {
  issues.push(
    issue(
      "official-evidence-backlog",
      "Расширить доказательства официальных правил",
      [
        "Для части правил сохранён официальный URL, но ещё нет ни точной цитаты для конкретной связки, ни вручную проверенной и запечатанной полной официальной матрицы.",
        "Ни одна строка из внешнего набора не была автоматически повышена до статуса «проверено».",
        "",
        `Проверено: ${checkedAt}`,
        `Состояние: **${officialEvidence.overallState}**`,
        `Подтверждено policy-связок: **${evidenceSummary.verifiedPolicyPairCount ?? 0}/${evidenceSummary.activePolicyPairCount ?? 0}**`,
        `Не хватает точных цитат для policy-связок: **${missingPolicyEvidencePairCount}**`,
        `Проверено территориальных матриц: **${evidenceSummary.verifiedTerritoryPolicyCount ?? 0}/${evidenceSummary.territoryPolicyCount ?? 0}**`,
        `Покрыто строк территориальных матриц: **${evidenceSummary.verifiedTerritoryMatrixRuleCount ?? 0}/${evidenceSummary.territoryMatrixRuleCount ?? 0}**`,
        `Не хватает строк территориальных матриц: **${missingTerritoryMatrixEvidenceRuleCount}**`,
        `Официальных metadata-only строк: **${evidenceSummary.metadataOnlyRuleCount ?? 0}**`,
        `Устаревших доказательств: **${staleEvidenceCount}**`,
        "",
        "Действие: открыть `official_evidence_report.json`. Для отдельных связок добавлять точные цитаты; для полной таблицы, списка или нормативного приложения — только после ручного сравнения всей матрицы и её запечатывания. Один URL остаётся метаданными.",
      ].join("\n")
    )
  );
}

if ((territory?.changedSourceCount ?? 0) > 0) {
  issues.push(
    issue(
      "territory-source-review",
      "Проверить источники территорий",
      [
        "Матрицы территорий оставлены без изменений.",
        "",
        `Проверено: ${checkedAt}`,
        `Изменённых страниц: ${territory.changedSourceCount ?? 0}`,
        `Недоступных страниц: ${territory.unavailableSourceCount ?? 0}`,
        "",
        shortLines(territory.changedSources ?? [], (url) => `- ${url}`),
        "",
        "Действие: изучить `territory_source_watch_candidate.json`; принимать новый отпечаток только после проверки матрицы и источника.",
      ].join("\n")
    )
  );
}

if ((territory?.unavailableSourceCount ?? 0) > 0) {
  monitoringLimitations.push({
    key: "territory-source-access",
    label: "Недоступны официальные страницы территорий",
    sourceCount: territory.unavailableSourceCount,
    sources: (territory.unavailableSources ?? []).map((source) => ({
      url: source.url,
      error: source.error ?? null,
    })),
  });
}

if (updateOutcome !== "success") {
  issues.push(
    issue(
      "update-pipeline-failure",
      "Сбой безопасного обновления",
      [
        "Updater завершился неуспешно; изменения не должны публиковаться.",
        "",
        `Проверено: ${checkedAt}`,
        `GitHub Actions outcome: **${updateOutcome}**`,
        `Результат updater: **${updateResult}**`,
        "",
        "Действие: открыть лог шага updater. Частые причины — массовое изменение, неполная таблица, недоступный источник или истёкшее официальное правило.",
      ].join("\n")
    )
  );
}

if (validationOutcome !== "success") {
  issues.push(
    issue(
      "validation-failure",
      "Не прошли проверки данных",
      [
        "Новая база не должна публиковаться, пока `node validate_all.mjs` не завершится успешно.",
        "",
        `Проверено: ${checkedAt}`,
        `GitHub Actions outcome: **${validationOutcome}**`,
      ].join("\n")
    )
  );
}

const overallStatus =
  issues.length > 0
    ? "review-required"
    : monitoringLimitations.length > 0
      ? "monitoring-limited"
      : "healthy";

const status = {
  schemaVersion: 1,
  checkedAt,
  overallStatus,
  lastKnownGoodRetained: true,
  publication: {
    updateOutcome,
    validationOutcome,
    updateResult,
    eligible:
      updateOutcome === "success" &&
      validationOutcome === "success" &&
      ["updated", "no_changes"].includes(updateResult),
  },
  auditSteps: {
    external: externalAuditOutcome,
    official: officialAuditOutcome,
    officialEvidence: officialEvidenceOutcome,
    territory: territoryAuditOutcome,
  },
  externalSources: external
    ? {
        state: external.overallState ?? "invalid-report",
        summary: external.summary ?? null,
      }
    : { state: "report-missing" },
  officialSources: official
    ? {
        state: official.overallState ?? "invalid-report",
        summary: official.summary ?? null,
      }
    : { state: "report-missing" },
  officialEvidence: officialEvidence
    ? {
        state: officialEvidence.overallState ?? "invalid-report",
        summary: officialEvidence.summary ?? null,
      }
    : { state: "report-missing" },
  territorySources: territory
    ? {
        changedSourceCount: territory.changedSourceCount ?? 0,
        unavailableSourceCount: territory.unavailableSourceCount ?? 0,
      }
    : { state: "report-missing" },
  monitoringLimitations: {
    limitationCount: monitoringLimitations.length,
    unavailableSourceCount: monitoringLimitations.reduce(
      (count, limitation) => count + limitation.sourceCount,
      0
    ),
    items: monitoringLimitations,
  },
  issues: issues.map(({ key, title }) => ({ key, title })),
};

fs.writeFileSync(STATUS_FILE, jsonText(status));
fs.writeFileSync(ISSUES_FILE, jsonText({ schemaVersion: 1, checkedAt, issues }));
console.log(
  `Monitor status: ${status.overallStatus}; ${issues.length} issue key(s), ` +
    `${monitoringLimitations.length} access limitation(s).`
);
