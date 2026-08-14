# Аудит 25 территорий — Borderly Data v17

Проверено: 14 августа 2026 года. Область: краткосрочный туристический въезд по
обычному паспорту. Матрица содержит 199 паспортов для каждого направления.

Числа ниже — контрольная сумма распределения категорий, а не рейтинг. Полные
списки паспортов, сроки, условия и ссылки находятся в
`territory_official_policies.json` и опубликованных правилах v17.

| ISO | Направление | Распределение 199 паспортов | Официальный источник |
|---|---|---|---|
| AS | Американское Самоа | спецразрешение 155; eVisa 43; без визы 1 | [Department of Legal Affairs](https://legalaffairs.as.gov/visitor-visa-home) |
| BM | Бермуды | нужна виза 72; без визы 127 | [Government of Bermuda](https://www.gov.bm/news/update-bermuda-immigration-and-protection-prohibition-entry-order-2025) |
| VG | Британские Виргинские острова | eVisa 86; без визы 113 | [BVI Visa Unit](https://bvi.org.uk/visas/) |
| KY | Каймановы острова | нужна виза 108; без визы 91 | [Cayman Islands CBC](https://gov.ky/web/cbc/travel/visas-extensions/visitors-visas/list-of-countries-visa-required) |
| YT | Майотта | нужна виза 103; без визы 69; свобода 27 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000030235682/) |
| CK | Острова Кука | без визы 199 | [Cook Islands MFAI](https://mfai.gov.ck/visa-and-permit-criteria) |
| FK | Фолклендские острова | нужна виза 109; без визы 90 | [Customs and Immigration](https://www.gov.fk/customs/new-visa-nationality-list-for-visitors-to-the-falkland-islands/) |
| AX | Аландские острова | нужна виза 104; без визы 63; свобода 31; въезд ограничен 1 | [Ministry for Foreign Affairs of Finland](https://um.fi/visa-requirement-and-travel-documents-accepted-by-finland) |
| GF | Французская Гвиана | нужна виза 106; без визы 66; свобода 27 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000024403998) |
| PF | Французская Полинезия | нужна виза 104; без визы 94; свобода 1 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000025092900/) |
| GI | Гибралтар | нужна виза 104; без визы 95 | [HM Government of Gibraltar](https://www.gibraltar.gov.gi/press-releases/technical-notice-reminder-concerning-visa-arrangements-5582026-12201) |
| GU | Гуам | въезд ограничен 39; нужна виза 109; eTA 46; без визы 4; свобода 1 | [8 CFR §212.1](https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-212/section-212.1) |
| GP | Гваделупа | нужна виза 105; без визы 67; свобода 27 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000024403998) |
| MQ | Мартиника | нужна виза 105; без визы 67; свобода 27 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000024403998) |
| MS | Монтсеррат | eVisa 86; без визы 112; нет данных 1 | [Montserrat Immigration](https://www.immigration.ms/countries/visa_required) |
| NC | Новая Каледония | нужна виза 104; без визы 94; свобода 1 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000024389411/) |
| NU | Ниуэ | нужна виза 160; без визы 37; разные условия 2 | [Niue visitor information](https://www.niueisland.com/discover-niue/travelling-to-niue) |
| MP | Северные Марианские острова | въезд ограничен 39; нужна виза 108; eTA 47; без визы 4; свобода 1 | [8 CFR §212.1](https://www.ecfr.gov/current/title-8/chapter-I/subchapter-B/part-212/section-212.1) |
| RE | Реюньон | нужна виза 104; без визы 68; свобода 27 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000024403998) |
| BL | Сен-Бартелеми | нужна виза 106; без визы 92; свобода 1 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000025746952) |
| AI | Ангилья | eVisa 113; без визы 86 | [Government of Anguilla](https://evisa.gov.ai/Countries) |
| MF | Сен-Мартен | нужна виза 106; без визы 66; свобода 27 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000025746952) |
| PM | Сен-Пьер и Микелон | нужна виза 106; без визы 92; свобода 1 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000024403998) |
| TC | Теркс и Кайкос | нужна виза 122; без визы 77 | [TCI Border Force](https://borderforce.gov.tc/entry-requirements) |
| WF | Уоллис и Футуна | нужна виза 104; без визы 94; свобода 1 | [Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000024404049/) |

## Важные решения классификации

- Анкета прибытия не меняет визовый статус и хранится отдельно от визовой базы.
- Электронная подача заявления считается eVisa только там, где официальный
  режим действительно выдаёт визу/разрешение до поездки.
- Программы Guam-CNMI Visa Waiver и EVS-TAP относятся к `eta`, а не к eVisa.
- Условная льгота по визе или ВНЖ третьей страны остаётся условием в карточке,
  а базовая категория паспорта не становится «без визы».
- Для Монтсеррата связка с Косово остаётся `no data`: официальный сайт не
  включает её ни в подтверждённый визовый, ни в безвизовый список.
- Для Ниуэ два правила помечены `mixed requirements`, потому что официальный
  текст связывает льготу с постоянным проживанием, а не только с гражданством.

## Контроль обновлений

`check_territory_sources.mjs` проверяет 19 уникальных официальных страниц.
Доступные страницы контролируются по нормализованному SHA-256. Страницы,
блокирующие автоматический доступ, остаются в отчёте как недоступные. Ни один
HTTP-сбой или произвольное изменение текста не меняет утверждённый визовый
статус автоматически: сначала создаётся артефакт для проверки.
