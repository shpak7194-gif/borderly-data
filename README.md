# Borderly visa data

Файлы для удалённого обновления визовой базы Borderly.

- `version.json` — маленький файл, который приложение проверяет раз в 24 часа.
- `visa_requirements.json` — полная визовая база.
- `destinations.json` — отдельный каталог из 248 направлений.
- `territory_derivations.json` — исторические прозрачные правила для 19 территорий,
  отсутствующих в расширенном источнике.
- `territory_audit_registry.json` — Data v8 реестр всех 49 направлений вне
  основного Passport Index с политикой заморозки/проверки.
- `audit_territories.mjs` — отдельный аудит территориальных правил Data v8.
- `official_rule_policies.json` — подтверждённые официальными источниками
  правила, которые имеют приоритет над общими наборами данных.
- `validate_visa_data.mjs` — проверка матрицы 199 паспортов × 248 направлений и
  защищённых официальных правил.

## Как выпустить обновление вручную

1. Изменить `visa_requirements.json` или правила генератора.
2. Запустить `node validate_visa_data.mjs`.
3. Увеличить `version` в `version.json` на 1.
4. Обновить поле `updated`.
5. Загрузить оба файла в репозиторий.

Приложение скачает новый `visa_requirements.json` только если `version`
стал больше локальной версии.

Не удаляйте старую рабочую базу до проверки новой.

## Покрытие матрицы

Генератор разделяет две сущности: 199 паспортных юрисдикций и 248 направлений.
Страна собственного паспорта не хранится в строке, поэтому каждая строка
содержит ровно 247 правил. Рейтинг Borderly по-прежнему получает балл только за
`visa free` и `freedom`; eTA, eVisa и виза по прибытии остаются отдельными
информационными категориями.

Основной открытый источник даёт текущие правила и сроки для 199 направлений.
Расширенный еженедельный снимок добавляет категории до 227 направлений. Ещё 19
ISO-территорий рассчитываются прозрачными правилами наследования или
фиксированным режимом из `territory_derivations.json`. Если расширенный источник
временно недоступен, workflow сохраняет последнюю подтверждённую расширенную
матрицу.

Специальные проверки из `official_entry_watches.json`,
`special_mobility_watches.json`, `official_rule_policies.json` и отдельная
проверка Гренландии имеют приоритет над общим источником. Если официальный сайт
временно недоступен или результат нельзя уверенно распознать, последнее
подтверждённое правило сохраняется. Общий Passport Index не может затереть
такое правило.

Версия 6 добавляет 45 защищённых связок: ограничения туристического въезда в
США по Proclamation 10998, 30-дневный безвизовый режим Китая для паспортов
Канады и Великобритании, а также актуальные режимы Тайваня для паспортов Гаити,
России, Турции и Омана. Временное правило Россия → Тайвань автоматически
перестаёт применяться после 6 июля 2027 года, если политика не будет продлена.

## Лицензия расширенного снимка

Расширенная часть использует набор `Global Passport Power Rankings & Visa
Requirements` по лицензии CC BY-NC 4.0. Эта сборка подходит для разработки,
тестирования и некоммерческого использования. Перед коммерческим выпуском
нужно заменить расширенный источник на лицензированный коммерческий API.
Полная атрибуция находится в `DATA_ATTRIBUTION.md`.

## Borderly Data v7 quality layer

Data v7 uses an **accuracy-first** publishing pipeline. The Android app still downloads
`version.json` and `visa_requirements.json` from GitHub Pages, but a candidate database
must now pass a separate quality layer before it can replace the published file.

Key rules:

- Official policies have priority over general feeds.
- `freedom` is closed by default and is allowed only for pairs listed in
  `freedom_registry.json`.
- General-feed category changes are quarantined instead of being silently published.
  Same-category stay-length updates may still be accepted automatically.
- The extended 227-destination dataset no longer overrides `passport-index-core`
  categories. It is only a secondary source for extended-only destinations.
- Existing territory derivations are frozen during ordinary scheduled updates. A
  derivation refresh requires an explicit reviewed migration.
- `regression_rules.json` protects known-good edge cases from returning to an older
  incorrect status.
- `audit_data_quality.mjs` validates the currently published database. The updater
  also writes `data_quality_review.json`; blocked candidates are preserved as
  `visa_requirements.candidate.json` and uploaded as a GitHub Actions artifact.

A successful GitHub Action therefore follows this order:

`published DB -> quality audit -> source update -> official policies -> quarantine -> candidate audit -> publish`

Data v7 Core is the guardrail layer. Historical extended/territory records still need
an official-source audit before the entire 199 × 248 matrix can be described as fully
certified.


## Borderly Data v8 territory safety

Data v8 расширяет защиту v7 на все 49 направлений вне основного Passport Index.
Каждое такое направление теперь обязано присутствовать в
`territory_audit_registry.json`. Существующее правило для non-core направления
полностью заморожено для обычного extended-источника: он не может автоматически
поменять ни категорию, ни срок пребывания.

Для режимов, которые нельзя честно описать обычным визовым статусом, добавлены
`special permit` и `mixed requirements`. Текущая Android-версия безопасно сводит
неизвестные статусы к `NO_DATA`, поэтому она не должна показывать выдуманное
«Без визы» или «Нужна виза».

После миграции реестр покрывает 49/49 non-core направлений: 10 сертифицированных
parent-link правил, 4 направления по общему официальному списку Нидерландов,
10 фиксированных safety-политик и 25 замороженных направлений, которые ещё требуют
отдельной проверки по официальным государственным источникам.

Подробности: `DATA_QUALITY_V8.md`.


## Data v9 — single source of truth

Visa categories are authoritative in `visa_requirements.json`; Android must not override them locally. See `DATA_QUALITY_V9.md`.
