# Borderly Data v9 — Single Source of Truth

## Цель

Визовый статус определяется только опубликованной базой `visa_requirements.json`. Android-клиент больше не должен содержать локальные таблицы, которые меняют `visa free` на `freedom` или любую другую категорию.

## Что перенесено на сервер

- Россия ↔ Беларусь остаётся в официальном реестре `freedom`.
- Россия → Таджикистан остаётся строго `visa free`.
- Свобода передвижения EU/EEA/Switzerland перенесена из Android в `freedom_registry.json`.
- Для EU-граждан отдельно защищены представленные в Borderly внешние регионы ЕС.
- Åland учитывается через официальный финский режим для EU/EEA/Swiss граждан; местные ограничения права domicile/property/business не трактуются как визовая обязанность.

## Защита

`test_freedom_registry.mjs` проверяет, что:

1. каждая `freedom`-запись находится в закрытом реестре;
2. каждая запись реестра реально опубликована как `freedom`;
3. у неё есть источник, URL и дата проверки;
4. контрольные пары DE→FR, NO→SE, CH→DE, RU→BY не регрессируют;
5. RU→TJ не может снова стать `freedom`.

Всего authoritative freedom pairs: 1135.

## Архитектурное правило

`visa_requirements.json` = единственный источник визовой категории для Android.
Клиент может отдельно помечать только `HOME_COUNTRY`, потому что это локальное UI-состояние, а не визовое правило.


### Faroe Islands / Greenland
Nordic passports (DK/FI/IS/NO/SE) are `freedom`. Other EU/EEA/Swiss passports are not promoted to `freedom` merely because Denmark itself is in the EEA free-movement network.
