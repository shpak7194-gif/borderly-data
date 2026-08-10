import fs from "node:fs";
import path from "node:path";

const UPSTREAM_URL =
  "https://raw.githubusercontent.com/imorte/passport-index-data/refs/heads/main/passport-index.json";
const SOURCE_REPO = "https://github.com/imorte/passport-index-data";
const DATABASE_FILE = "visa_requirements.json";
const VERSION_FILE = "version.json";
const DESTINATIONS_FILE = "destinations.json";
const TERRITORY_DERIVATIONS_FILE = "territory_derivations.json";
const OFFICIAL_WATCHES_FILE = "official_entry_watches.json";
const SPECIAL_MOBILITY_WATCHES_FILE = "special_mobility_watches.json";
const OFFICIAL_RULE_POLICIES_FILE = "official_rule_policies.json";
const OFFICIAL_FETCH_TIMEOUT_MS = 15000;

const GREENLAND_DESTINATION_NUMERIC = "304";
const GREENLAND_ENTRY_URL =
  "https://www.nyidanmark.dk/en-GB/You-want-to-apply/Short-stay-visa/Visa-to-the-Faroe-Island-or-Greenland";
const GREENLAND_COUNTRY_LIST_URL =
  "https://nyidanmark.dk/en-GB/Words-and-concepts/US/Visum/Countries-with-a-visa-requirement-and-visa-free-countries";
const GREENLAND_SOURCE = "Danish Immigration Service";
const MAX_GREENLAND_CHANGED_RULES = 20;

const MAX_CHANGED_RULES = 2500;
const MAX_EXTENDED_CHANGED_RULES = 2500;
const EXPECTED_PASSPORTS = 199;
const EXPECTED_DESTINATIONS = 248;
const MIN_PASSPORTS = EXPECTED_PASSPORTS;
const MIN_RULES_PER_PASSPORT = EXPECTED_DESTINATIONS - 1;

const destinationManifest = JSON.parse(
  fs.readFileSync(path.resolve(DESTINATIONS_FILE), "utf8")
);
if (
  destinationManifest.destinationCount !== EXPECTED_DESTINATIONS ||
  destinationManifest.destinations?.length !== EXPECTED_DESTINATIONS
) {
  throw new Error(
    `Destination manifest must contain exactly ${EXPECTED_DESTINATIONS} entries`
  );
}

const NUMERIC_TO_ISO2 = Object.fromEntries(
  destinationManifest.destinations.map((destination) => [
    String(destination.numeric),
    destination.iso2,
  ])
);
const DESTINATION_BY_NUMERIC = new Map(
  destinationManifest.destinations.map((destination) => [
    String(destination.numeric),
    destination,
  ])
);

const ISO2_TO_NUMERIC = Object.fromEntries(
  Object.entries(NUMERIC_TO_ISO2).map(([numeric, iso2]) => [iso2, numeric])
);

const ALLOWED_STATUSES = new Set([
  "home country",
  "freedom",
  "visa free",
  "eta",
  "e-visa",
  "visa on arrival",
  "visa required",
  "entry restricted",
  "no admission",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stableRule(rule) {
  const out = { status: rule.status };
  if (Number.isFinite(rule.days) && rule.days > 0) out.days = rule.days;
  return out;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

const EXTENDED_STATUS_MAP = {
  visa_free_access: "visa free",
  electronic_travel_authorisation: "eta",
  visa_on_arrival: "visa on arrival",
  visa_online: "e-visa",
  visa_required: "visa required",
};

function loadExtendedSource() {
  const filename = process.env.EXTENDED_SOURCE_FILE;
  if (!filename) {
    console.warn(
      "EXTENDED_SOURCE_FILE is not set. Existing extended rules will be preserved."
    );
    return null;
  }

  const lines = fs
    .readFileSync(filename, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 45000) {
    throw new Error(`Extended source is unexpectedly small: ${lines.length - 1} rows`);
  }

  const headers = parseCsvLine(lines[0]);
  const indexOf = (name) => {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(`Extended source is missing column ${name}`);
    return index;
  };
  const passportIndex = indexOf("from_country_code");
  const destinationIndex = indexOf("to_country_code");
  const requirementIndex = indexOf("requirement_type");

  const byPassport = new Map();
  const destinationCodes = new Set();
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const passportIso2 = values[passportIndex];
    const destinationIso2 = values[destinationIndex];
    const status = EXTENDED_STATUS_MAP[values[requirementIndex]];
    if (!passportIso2 || !destinationIso2 || !status) {
      throw new Error(`Bad extended source row: ${line.slice(0, 160)}`);
    }
    const rules = byPassport.get(passportIso2) ?? new Map();
    rules.set(destinationIso2, { status });
    byPassport.set(passportIso2, rules);
    destinationCodes.add(destinationIso2);
  }

  if (byPassport.size !== EXPECTED_PASSPORTS || destinationCodes.size !== 227) {
    throw new Error(
      `Extended source shape mismatch: passports=${byPassport.size}, ` +
        `destinations=${destinationCodes.size}`
    );
  }
  return byPassport;
}

function applyExtendedDestinations(database, extendedByPassport) {
  const isInitialExpansion = Object.values(database.passports ?? {}).some(
    (rules) => Object.keys(rules ?? {}).length < EXPECTED_DESTINATIONS - 1
  );
  const next = structuredClone(database);
  const derivations = readJson(path.resolve(TERRITORY_DERIVATIONS_FILE)).rules ?? [];
  const derivationByDestination = new Map(
    derivations.map((derivation) => [derivation.destination, derivation])
  );
  const desiredIds = new Set(
    destinationManifest.destinations.map((destination) => String(destination.numeric))
  );
  let addedRules = 0;
  let changedRules = 0;
  let removedRules = 0;

  const assignRule = (row, destinationId, desiredRule) => {
    if (!desiredRule) return;
    const currentRule = row[destinationId];
    if (hasManualOverride(currentRule)) return;
    const normalized = stableRule(desiredRule);
    if (
      currentRule?.status === normalized.status &&
      normalized.days === undefined &&
      currentRule.days !== undefined
    ) {
      normalized.days = currentRule.days;
    }
    if (!currentRule) {
      row[destinationId] = normalized;
      addedRules += 1;
    } else if (!sameRule(currentRule, normalized)) {
      row[destinationId] = normalized;
      changedRules += 1;
    }
  };

  for (const [passportId, row] of Object.entries(next.passports ?? {})) {
    const passportIso2 = NUMERIC_TO_ISO2[passportId];
    const extendedRules = extendedByPassport?.get(passportIso2) ?? null;

    // The map represents the passport country separately, so the database row
    // contains exactly the other 247 destinations.
    if (row[passportId]) {
      delete row[passportId];
      removedRules += 1;
    }
    for (const destinationId of Object.keys(row)) {
      if (!desiredIds.has(destinationId)) {
        delete row[destinationId];
        removedRules += 1;
      }
    }

    // Phase 1: apply every directly sourced category first. Derived territories
    // must see the new parent category during the same migration run.
    for (const destination of destinationManifest.destinations) {
      const destinationId = String(destination.numeric);
      if (destinationId === passportId) continue;
      if (destination.iso2 === "GL" && row[destinationId]?.source) {
        continue;
      }

      if (
        destination.sourceKind === "passport-index-core" ||
        destination.sourceKind === "extended-227"
      ) {
        if (extendedRules) {
          assignRule(row, destinationId, extendedRules.get(destination.iso2));
        }
        continue;
      }

      if (destination.sourceKind === "extended-fw-split") {
        if (extendedRules) assignRule(row, destinationId, extendedRules.get("FW"));
      }
    }

    // Phase 2: derive the 19 ISO territories that are absent from the
    // 227-destination source.
    for (const destination of destinationManifest.destinations) {
      if (destination.sourceKind !== "derived-territory") continue;
      const destinationId = String(destination.numeric);
      if (destinationId === passportId) continue;
      const derivation = derivationByDestination.get(destination.iso2);
      if (!derivation) {
        throw new Error(`No derivation for destination ${destination.iso2}`);
      }

      let desiredRule = null;
      if (derivation.strategy === "fixed") {
        desiredRule = { status: derivation.status };
      } else if (derivation.strategy === "mirror") {
        if (passportIso2 === derivation.from && derivation.selfFallback) {
          desiredRule = { status: derivation.selfFallback };
        } else {
          const sourceId = ISO2_TO_NUMERIC[derivation.from];
          desiredRule = sourceId ? row[sourceId] : null;
        }
      } else if (derivation.strategy === "mirrorExtended") {
        desiredRule = extendedRules?.get(derivation.from) ?? null;
      } else {
        throw new Error(
          `Unknown derivation strategy ${derivation.strategy} for ${destination.iso2}`
        );
      }
      assignRule(row, destinationId, desiredRule);
    }
  }

  if (!isInitialExpansion && changedRules > MAX_EXTENDED_CHANGED_RULES) {
    throw new Error(
      `Extended-data safety stop: ${changedRules} existing rules changed ` +
        `(limit ${MAX_EXTENDED_CHANGED_RULES})`
    );
  }

  return {
    database: next,
    addedRules,
    changedRules,
    removedRules,
    isInitialExpansion,
  };
}

function expandSupportedMatrix(current, upstream) {
  const next = structuredClone(current);
  next.passports ??= {};
  let addedPassports = 0;
  let addedRules = 0;

  const upstreamPassportIds = Object.keys(upstream).sort();
  if (upstreamPassportIds.length !== EXPECTED_PASSPORTS) {
    throw new Error(
      `Unexpected upstream passport count: ${upstreamPassportIds.length} ` +
        `(expected ${EXPECTED_PASSPORTS})`
    );
  }

  for (const passportIso2 of upstreamPassportIds) {
    const passportId = ISO2_TO_NUMERIC[passportIso2];
    if (!passportId) {
      throw new Error(`No ISO numeric id for upstream passport ${passportIso2}`);
    }

    if (!next.passports[passportId]) {
      next.passports[passportId] = {};
      addedPassports += 1;
    }

    const row = next.passports[passportId];
    const upstreamRules = upstream[passportIso2] ?? {};
    for (const [destinationIso2, upstreamRule] of Object.entries(upstreamRules)) {
      const destinationId = ISO2_TO_NUMERIC[destinationIso2];
      if (!destinationId) {
        throw new Error(
          `No ISO numeric id for upstream destination ${destinationIso2}`
        );
      }
      if (row[destinationId] === undefined) {
        row[destinationId] = stableRule(upstreamRule);
        addedRules += 1;
      }
    }
  }

  return { database: next, addedPassports, addedRules };
}

function sameRule(a, b) {
  return a?.status === b?.status && (a?.days ?? null) === (b?.days ?? null);
}

function sameFullRule(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function htmlToText(html) {
  return String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&uuml;/gi, "ü")
    .replace(/&ouml;/gi, "ö")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&(?:rsquo|lsquo);/gi, "'")
    .replace(/&(?:ndash|mdash);/gi, "-")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function matchesAny(text, patterns = []) {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}

function matchesAllMarkers(text, markers = []) {
  return markers.every((marker) => text.includes(String(marker).toLowerCase()));
}

function watchedKey(passportId, destinationId) {
  return `${passportId}:${destinationId}`;
}

function normalizeCountryName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’‘`]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function htmlToLines(html) {
  return String(html ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|div|section|article|h[1-6]|tr|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&uuml;/gi, "ü")
    .replace(/&ouml;/gi, "ö")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&(?:rsquo|lsquo);/gi, "'")
    .replace(/&(?:ndash|mdash);/gi, "-")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

async function fetchOfficialText(url, fixtureEnvName = null) {
  if (fixtureEnvName && process.env[fixtureEnvName]) {
    return fs.readFileSync(process.env[fixtureEnvName], "utf8");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    OFFICIAL_FETCH_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (compatible; BorderlyOfficialWatch/3.0; +https://shpak7194-gif.github.io/borderly-data/)",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    if (!html || html.length < 200) {
      throw new Error("empty/too small response");
    }
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

const GREENLAND_NAME_ALIASES = {
  BA: ["Bosnia-Herzegovina", "Bosnia and Herzegovina"],
  BN: ["Brunei Darussalam", "Brunei"],
  CD: ["Democratic Republic of Congo"],
  CG: ["Congo"],
  CI: ["Ivory Coast", "Cote d'Ivoire", "Côte d’Ivoire"],
  CV: ["Cape Verde", "Cabo Verde"],
  CZ: ["Czech Republic", "Czechia"],
  GB: ["United Kingdom"],
  HK: ["Hong Kong"],
  KN: ["Saint Kitts and Nevis", "St. Kitts and Nevis"],
  KP: ["North Korea"],
  KR: ["South Korea", "Republic of Korea"],
  LC: ["Saint Lucia", "St. Lucia"],
  MK: ["North Macedonia"],
  MM: ["Myanmar", "Burma (Myanmar)", "Burma"],
  PS: [
    "Passports issued by the Palestinian Authority",
    "Palestinian Authority",
    "Palestine",
  ],
  ST: ["Sao Tomé and Principe", "Sao Tome and Principe", "São Tomé and Príncipe"],
  TJ: ["Tadjikistan", "Tajikistan"],
  TN: ["Tunesia", "Tunisia"],
  TR: ["Türkiye", "Turkey"],
  TT: ["Trinidad and Tobago", "Trinidad & Tobago"],
  US: ["United States"],
  VC: ["Saint Vincent and the Grenadines", "St. Vincent and the Grenadines"],
  XK: ["Kosovo"],
};

const regionDisplayNames = new Intl.DisplayNames(["en"], { type: "region" });

function greenlandCountryNames(iso2) {
  const values = [
    ...(GREENLAND_NAME_ALIASES[iso2] ?? []),
    regionDisplayNames.of(iso2),
  ].filter(Boolean);

  return [...new Set(values.map((value) => normalizeCountryName(value)))];
}

function sectionHasCountry(lines, iso2) {
  const names = greenlandCountryNames(iso2);
  return lines.some((line) => {
    const normalized = normalizeCountryName(line);
    return names.some((name) => {
      if (!normalized.startsWith(name)) return false;
      const next = normalized.slice(name.length, name.length + 1);
      return next === "" || /[\s(*]/.test(next);
    });
  });
}

function parseGreenlandVisaList(html) {
  const lines = htmlToLines(html);
  const normalized = lines.map(normalizeCountryName);

  const requiredIndex = normalized.findIndex(
    (line) => line === "countries with a visa requirement"
  );
  const visaFreeIndex = normalized.findIndex(
    (line, index) =>
      index > requiredIndex && line === "visa-free countries"
  );

  if (requiredIndex < 0 || visaFreeIndex <= requiredIndex) {
    throw new Error("official visa-list section headings were not found");
  }

  const requiredLines = lines.slice(requiredIndex + 1, visaFreeIndex);
  const freeLines = lines.slice(visaFreeIndex + 1);

  return { requiredLines, freeLines };
}

async function inspectGreenlandPolicy(current) {
  if (process.env.OFFICIAL_CHECKS_OFFLINE === "1") {
    return {
      state: "error",
      reason: "official checks disabled for this local validation run",
      classifications: new Map(),
      recognized: 0,
      duplicateVisaClasses: 0,
    };
  }
  try {
    const [entryHtml, listHtml] = await Promise.all([
      fetchOfficialText(
        GREENLAND_ENTRY_URL,
        "GREENLAND_ENTRY_FIXTURE_FILE"
      ),
      fetchOfficialText(
        GREENLAND_COUNTRY_LIST_URL,
        "GREENLAND_LIST_FIXTURE_FILE"
      ),
    ]);

    const entryText = htmlToText(entryHtml);
    const entryPolicyRecognized =
      entryText.includes("faroe islands or greenland") &&
      entryText.includes("visa-exempt country") &&
      entryText.includes("without a visa") &&
      entryText.includes("country with a visa requirement");

    if (!entryPolicyRecognized) {
      return {
        state: "uncertain",
        reason: "Greenland entry-policy markers were not found",
        classifications: new Map(),
        recognized: 0,
      };
    }

    const { requiredLines, freeLines } = parseGreenlandVisaList(listHtml);
    const classifications = new Map();
    let duplicateVisaClasses = 0;
    let greenlandRules = 0;

    for (const [passportId] of Object.entries(current.passports ?? {})) {
      greenlandRules += 1;

      const iso2 = NUMERIC_TO_ISO2[passportId];
      if (!iso2) continue;

      const hongKongExplicitlyExempt =
        iso2 === "HK" &&
        requiredLines.some((line) => {
          const normalized = normalizeCountryName(line);
          return (
            normalized.includes("hong kong special administrative region") &&
            normalized.includes("exempt from the visa requirement")
          );
        });

      const isFree =
        hongKongExplicitlyExempt || sectionHasCountry(freeLines, iso2);
      const isRequired =
        iso2 === "HK" ? false : sectionHasCountry(requiredLines, iso2);

      // Several countries appear in both official sections because the visa
      // exemption is limited to biometric ordinary passports. Borderly models
      // the currently issued ordinary passport, so the visa-free entry wins.
      if (isFree && isRequired) duplicateVisaClasses += 1;

      if (isFree) {
        classifications.set(passportId, {
          status: "visa free",
          days: 90,
        });
      } else if (isRequired) {
        classifications.set(passportId, {
          status: "visa required",
        });
      }
    }

    const recognized = classifications.size;
    if (recognized < Math.max(170, greenlandRules - 8)) {
      return {
        state: "uncertain",
        reason:
          `official Greenland list recognized only ${recognized} of ` +
          `${greenlandRules} Borderly passport rules`,
        classifications,
        recognized,
        duplicateVisaClasses,
      };
    }

    return {
      state: "ready",
      reason: "official Greenland policy and country list recognized",
      classifications,
      recognized,
      duplicateVisaClasses,
    };
  } catch (error) {
    return {
      state: "error",
      reason: error?.message || String(error),
      classifications: new Map(),
      recognized: 0,
      duplicateVisaClasses: 0,
    };
  }
}

async function loadOfficialPage(watch) {
  if (process.env.OFFICIAL_FIXTURE_DIR) {
    const fixturePath = path.join(
      process.env.OFFICIAL_FIXTURE_DIR,
      `${watch.id}.html`
    );
    return {
      html: fs.readFileSync(fixturePath, "utf8"),
      sourceUrl: watch.sourceUrl ?? watch.sourceUrls?.[0] ?? "fixture",
      transport: "fixture",
    };
  }

  const candidateUrls = [
    ...(Array.isArray(watch.sourceUrls) ? watch.sourceUrls : []),
    ...(watch.sourceUrl ? [watch.sourceUrl] : []),
  ].filter((url, index, all) => url && all.indexOf(url) === index);

  if (candidateUrls.length === 0) {
    throw new Error("no official source URLs configured");
  }

  const failures = [];

  async function tryFetch(fetchUrl, officialSourceUrl, transport) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      OFFICIAL_FETCH_TIMEOUT_MS
    );

    try {
      const response = await fetch(fetchUrl, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          Accept: "text/html,text/plain,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
          "User-Agent":
            "Mozilla/5.0 (compatible; BorderlyOfficialWatch/3.0; +https://shpak7194-gif.github.io/borderly-data/)",
        },
      });

      if (!response.ok) {
        failures.push(
          `${officialSourceUrl} via ${transport} -> HTTP ${response.status}`
        );
        return null;
      }

      const html = await response.text();
      if (!html || html.length < 200) {
        failures.push(
          `${officialSourceUrl} via ${transport} -> empty/too small response`
        );
        return null;
      }

      return {
        html,
        sourceUrl: officialSourceUrl,
        transport,
      };
    } catch (error) {
      failures.push(
        `${officialSourceUrl} via ${transport} -> ${
          error?.message || String(error)
        }`
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Pass 1: always prefer the original government / ministry site.
  for (const sourceUrl of candidateUrls) {
    const loaded = await tryFetch(sourceUrl, sourceUrl, "direct");
    if (loaded) return loaded;
  }

  // Pass 2: if GitHub Actions is blocked by the origin, use Jina Reader only
  // as a transport layer. The content still comes from the same official URL,
  // and sourceUrl stored in Borderly remains the original official page.
  for (const sourceUrl of candidateUrls) {
    const readerUrl = `https://r.jina.ai/${sourceUrl}`;
    const loaded = await tryFetch(
      readerUrl,
      sourceUrl,
      "reader-mirror"
    );
    if (loaded) return loaded;
  }

  throw new Error(
    `all official sources failed: ${failures.join(" | ")}`
  );
}

async function inspectOfficialRestriction(watch) {
  if (process.env.OFFICIAL_CHECKS_OFFLINE === "1") {
    return {
      state: "error",
      reason: "official checks disabled for this local validation run",
      sourceUrl: null,
    };
  }
  try {
    const loaded = await loadOfficialPage(watch);
    const text = htmlToText(loaded.html);

    if (!matchesAllMarkers(text, watch.pageMarkers ?? [])) {
      return {
        state: "unknown",
        reason: `official page markers were not found at ${loaded.sourceUrl}`,
        sourceUrl: loaded.sourceUrl,
      };
    }

    const restricted = matchesAny(text, watch.restrictedPatterns ?? []);
    const released = matchesAny(text, watch.releasePatterns ?? []);

    // Explicit release wording wins over historical restriction wording. Official
    // pages often keep the old policy text when announcing that it was lifted.
    if (released) {
      return {
        state: "released",
        reason: `official release signal found via ${loaded.transport}`,
        sourceUrl: loaded.sourceUrl,
      };
    }

    if (restricted) {
      return {
        state: "restricted",
        reason: `official restriction signal found via ${loaded.transport}`,
        sourceUrl: loaded.sourceUrl,
      };
    }

    return {
      state: "neutral",
      reason: "official page is recognized but has no known restriction signal",
      sourceUrl: loaded.sourceUrl,
    };
  } catch (error) {
    return {
      state: "error",
      reason: error?.message || String(error),
      sourceUrl: null,
    };
  }
}

async function inspectSpecialMobility(watch) {
  if (process.env.OFFICIAL_CHECKS_OFFLINE === "1") {
    return {
      state: "error",
      reason: "official checks disabled for this local validation run",
      sourceUrl: null,
    };
  }
  try {
    const loaded = await loadOfficialPage(watch);
    const text = htmlToText(loaded.html);

    if (!matchesAllMarkers(text, watch.pageMarkers ?? [])) {
      return {
        state: "unknown",
        reason: `official page markers were not found at ${loaded.sourceUrl}`,
        sourceUrl: loaded.sourceUrl,
      };
    }

    const freedom = matchesAny(text, watch.freedomPatterns ?? []);
    const downgraded = matchesAny(text, watch.downgradePatterns ?? []);

    // Explicit downgrade/repeal wording wins, because historical pages may still
    // contain old descriptions of the special regime.
    if (downgraded) {
      return {
        state: "downgraded",
        reason: `official downgrade/repeal signal found via ${loaded.transport}`,
        sourceUrl: loaded.sourceUrl,
      };
    }

    if (freedom) {
      return {
        state: "freedom",
        reason: `official freedom-of-movement signal found via ${loaded.transport}`,
        sourceUrl: loaded.sourceUrl,
      };
    }

    return {
      state: "neutral",
      reason: "official page recognized but special mobility signal is unclear",
      sourceUrl: loaded.sourceUrl,
    };
  } catch (error) {
    return {
      state: "error",
      reason: error?.message || String(error),
      sourceUrl: null,
    };
  }
}

function todayIso() {
  return process.env.BORDERLY_TODAY ?? new Date().toISOString().slice(0, 10);
}

function loadOfficialRulePolicies() {
  const payload = readJson(path.resolve(OFFICIAL_RULE_POLICIES_FILE));
  const policies = payload.policies ?? [];
  const ids = new Set();
  const keys = new Set();

  if (payload.schemaVersion !== 1 || !Array.isArray(policies) || policies.length === 0) {
    throw new Error("Official rule policies are missing or use an unsupported schema");
  }

  for (const policy of policies) {
    if (!policy.id || ids.has(policy.id)) {
      throw new Error(`Duplicate or missing official policy id: ${policy.id}`);
    }
    ids.add(policy.id);

    if (
      !Array.isArray(policy.passportNumerics) ||
      policy.passportNumerics.length === 0 ||
      !DESTINATION_BY_NUMERIC.has(String(policy.destinationNumeric))
    ) {
      throw new Error(`Bad passport/destination coverage in policy ${policy.id}`);
    }
    if (!ALLOWED_STATUSES.has(policy.rule?.status)) {
      throw new Error(`Bad status in official policy ${policy.id}: ${policy.rule?.status}`);
    }
    if (
      policy.rule?.days !== undefined &&
      (!Number.isInteger(policy.rule.days) || policy.rule.days <= 0 || policy.rule.days > 3660)
    ) {
      throw new Error(`Bad stay length in official policy ${policy.id}`);
    }
    if (!policy.source || !policy.sourceUrl || !policy.verifiedAt) {
      throw new Error(`Incomplete source metadata in official policy ${policy.id}`);
    }

    for (const passportIdValue of policy.passportNumerics) {
      const passportId = String(passportIdValue);
      const destinationId = String(policy.destinationNumeric);
      if (!DESTINATION_BY_NUMERIC.has(passportId) || passportId === destinationId) {
        throw new Error(`Bad pair ${passportId}:${destinationId} in policy ${policy.id}`);
      }
      const key = watchedKey(passportId, destinationId);
      if (keys.has(key)) {
        throw new Error(`Official policies overlap at ${key}`);
      }
      keys.add(key);
    }
  }

  return policies;
}

async function inspectOfficialRulePolicy(policy) {
  const today = todayIso();
  if (policy.validFrom && today < policy.validFrom) {
    return {
      state: "scheduled",
      reason: `policy begins on ${policy.validFrom}`,
      sourceUrl: policy.sourceUrl,
    };
  }
  if (policy.validUntil && today > policy.validUntil) {
    return {
      state: "expired",
      reason: `verified policy ended on ${policy.validUntil}`,
      sourceUrl: policy.sourceUrl,
    };
  }
  if (process.env.OFFICIAL_CHECKS_OFFLINE === "1") {
    return {
      state: "verified-snapshot",
      reason: `using policy snapshot verified ${policy.verifiedAt}`,
      sourceUrl: policy.sourceUrl,
    };
  }

  try {
    const loaded = await loadOfficialPage(policy);
    const text = htmlToText(loaded.html);
    if (!matchesAllMarkers(text, policy.pageMarkers ?? [])) {
      return {
        state: "unknown",
        reason: `official page markers were not found at ${loaded.sourceUrl}`,
        sourceUrl: loaded.sourceUrl,
      };
    }

    if (matchesAny(text, policy.releasePatterns ?? [])) {
      return {
        state: "released",
        reason: `official release signal found via ${loaded.transport}`,
        sourceUrl: loaded.sourceUrl,
      };
    }
    if (
      (policy.activePatterns ?? []).length === 0 ||
      matchesAny(text, policy.activePatterns ?? [])
    ) {
      return {
        state: "active",
        reason: `official rule signal found via ${loaded.transport}`,
        sourceUrl: loaded.sourceUrl,
      };
    }

    return {
      state: "neutral",
      reason: "official page is recognized but the configured rule signal is unclear",
      sourceUrl: loaded.sourceUrl,
    };
  } catch (error) {
    return {
      state: "error",
      reason: error?.message || String(error),
      sourceUrl: null,
    };
  }
}

function officialPolicyRule(policy, sourceUrl = null) {
  const rule = {
    ...stableRule(policy.rule),
    officialPolicyId: policy.id,
    source: policy.source,
    sourceUrl: sourceUrl ?? policy.sourceUrl,
    updated: policy.verifiedAt,
  };
  if (policy.validUntil) rule.validUntil = policy.validUntil;
  if (policy.note) rule.note = policy.note;
  return rule;
}

function hasManualOverride(rule) {
  // Borderly rules backed by a dedicated source are deliberate overrides and
  // must never be silently replaced by the general Passport Index feed.
  return Boolean(rule?.source || rule?.sourceUrl || rule?.updated);
}

async function loadUpstream() {
  if (process.env.UPSTREAM_FILE) {
    return readJson(process.env.UPSTREAM_FILE);
  }

  const response = await fetch(UPSTREAM_URL, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Borderly-Data-Updater",
    },
  });

  if (!response.ok) {
    throw new Error(`Upstream download failed: HTTP ${response.status}`);
  }

  return await response.json();
}

function validateDatabase(database, manualSnapshot) {
  const errors = [];
  const entries = Object.entries(database.passports ?? {});

  if (entries.length < MIN_PASSPORTS) {
    errors.push(`Too few passports: ${entries.length}`);
  }

  for (const [passportId, rules] of entries) {
    const ruleEntries = Object.entries(rules ?? {});
    if (ruleEntries.length < MIN_RULES_PER_PASSPORT) {
      errors.push(`${passportId}: too few destination rules (${ruleEntries.length})`);
    }

    for (const [destinationId, rule] of ruleEntries) {
      if (!ALLOWED_STATUSES.has(rule?.status)) {
        errors.push(`${passportId} -> ${destinationId}: bad status ${rule?.status}`);
      }
      if (
        rule?.days !== undefined &&
        (!Number.isFinite(rule.days) || rule.days <= 0 || rule.days > 3660)
      ) {
        errors.push(`${passportId} -> ${destinationId}: bad days ${rule.days}`);
      }
    }
  }

  for (const [key, before] of manualSnapshot.entries()) {
    const [passportId, destinationId] = key.split(":");
    const after = database.passports?.[passportId]?.[destinationId];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      errors.push(`Manual override changed: ${passportId} -> ${destinationId}`);
    }
  }

  if (errors.length) {
    throw new Error(`Validation failed:\n${errors.slice(0, 50).join("\n")}`);
  }
}

async function main() {
  const databasePath = path.resolve(DATABASE_FILE);
  const versionPath = path.resolve(VERSION_FILE);
  const stored = readJson(databasePath);
  const version = readJson(versionPath);
  const upstream = await loadUpstream();
  const extendedByPassport = loadExtendedSource();
  const preserveExtendedCategories =
    !extendedByPassport && stored.source === "Borderly Extended Visa Data";
  const expansion = expandSupportedMatrix(stored, upstream);
  const current = expansion.database;
  const officialWatches = readJson(path.resolve(OFFICIAL_WATCHES_FILE)).watches ?? [];
  const watchesByKey = new Map(
    officialWatches.map((watch) => [
      watchedKey(watch.passportNumeric, watch.destinationNumeric),
      watch,
    ])
  );

  const mobilityWatches =
    readJson(path.resolve(SPECIAL_MOBILITY_WATCHES_FILE)).watches ?? [];
  const mobilityWatchesByKey = new Map(
    mobilityWatches.map((watch) => [
      watchedKey(watch.passportNumeric, watch.destinationNumeric),
      watch,
    ])
  );

  const officialRulePolicies = loadOfficialRulePolicies();
  const officialPolicyInspections = await Promise.all(
    officialRulePolicies.map(async (policy) => ({
      policy,
      inspection: await inspectOfficialRulePolicy(policy),
    }))
  );
  const officialPoliciesByKey = new Map();
  for (const item of officialPolicyInspections) {
    for (const passportId of item.policy.passportNumerics) {
      officialPoliciesByKey.set(
        watchedKey(String(passportId), String(item.policy.destinationNumeric)),
        item
      );
    }
  }

  const greenlandPolicy = await inspectGreenlandPolicy(current);

  let next = structuredClone(current);
  const manualSnapshot = new Map();
  let sourceCoveredRules = 0;
  let missingPassports = 0;
  let missingRules = 0;
  let changedRules = 0;
  let officialRestricted = 0;
  let officialReleased = 0;
  let officialUnknown = 0;
  let greenlandChangedRules = 0;
  let greenlandProtectedRules = 0;
  let mobilityFreedom = 0;
  let mobilityDowngraded = 0;
  let mobilityUncertain = 0;
  let mobilityChangedRules = 0;
  let mobilityBootstrapped = 0;
  const pendingGreenlandChanges = [];
  const changes = [];
  const officialChecks = [];
  const mobilityChecks = [];
  const officialPolicyChecks = [];
  let officialPolicyActivePairs = 0;
  let officialPolicyChangedRules = 0;
  let officialPolicyReleasedPairs = 0;
  let officialPolicyUncertainPairs = 0;

  for (const { policy, inspection } of officialPolicyInspections) {
    officialPolicyChecks.push(
      `${policy.label}: ${inspection.state} (${inspection.reason})` +
        (inspection.sourceUrl ? ` [${inspection.sourceUrl}]` : "")
    );
  }

  for (const [passportId, rules] of Object.entries(current.passports ?? {})) {
    const passportIso2 = NUMERIC_TO_ISO2[passportId];
    const upstreamRules = passportIso2 ? upstream[passportIso2] : undefined;

    if (!passportIso2 || !upstreamRules) {
      missingPassports += 1;
      continue;
    }

    for (const [destinationId, currentRule] of Object.entries(rules)) {
      const key = `${passportId}:${destinationId}`;

      const destinationIso2 = NUMERIC_TO_ISO2[destinationId];
      const destinationMetadata = DESTINATION_BY_NUMERIC.get(destinationId);
      const upstreamRule =
        destinationId === GREENLAND_DESTINATION_NUMERIC
          ? currentRule
          : destinationIso2
            ? upstreamRules[destinationIso2]
            : undefined;
      if (!upstreamRule) {
        if (destinationMetadata?.sourceKind === "passport-index-core") {
          missingRules += 1;
        }
        continue;
      }

      if (
        destinationMetadata?.sourceKind !== "passport-index-core" &&
        destinationId !== GREENLAND_DESTINATION_NUMERIC
      ) {
        continue;
      }

      sourceCoveredRules += 1;
      const normalized = stableRule(upstreamRule);
      if (!ALLOWED_STATUSES.has(normalized.status)) {
        throw new Error(
          `Unknown upstream status ${normalized.status} for ${passportIso2} -> ${destinationIso2}`
        );
      }

      if (destinationId === GREENLAND_DESTINATION_NUMERIC) {
        const officialGreenlandRule =
          greenlandPolicy.classifications.get(passportId);

        if (
          greenlandPolicy.state === "ready" &&
          officialGreenlandRule
        ) {
          if (!sameRule(currentRule, officialGreenlandRule)) {
            pendingGreenlandChanges.push({
              passportId,
              destinationId,
              passportIso2,
              destinationIso2,
              currentRule,
              desiredRule: {
                ...officialGreenlandRule,
                source: GREENLAND_SOURCE,
                sourceUrl: GREENLAND_COUNTRY_LIST_URL,
                updated: new Date().toISOString().slice(0, 10),
              },
            });
          }
        } else {
          // Greenland is a special destination and must remain protected if the
          // official policy/list cannot be interpreted with high confidence.
          manualSnapshot.set(key, structuredClone(currentRule));
          greenlandProtectedRules += 1;
        }
        continue;
      }

      const officialPolicyItem = officialPoliciesByKey.get(key);
      if (officialPolicyItem) {
        const { policy, inspection } = officialPolicyItem;
        let desiredRule = currentRule;

        if (inspection.state === "released" || inspection.state === "expired") {
          desiredRule = normalized;
          officialPolicyReleasedPairs += 1;
        } else if (inspection.state === "scheduled") {
          manualSnapshot.set(key, structuredClone(currentRule));
        } else {
          // The registry is a verified official snapshot. A temporary network
          // failure or a harmless page redesign must not let the general feed
          // reintroduce a known error. Only an explicit release signal or the
          // configured end date can remove the override automatically.
          desiredRule = officialPolicyRule(policy, inspection.sourceUrl);
          if (inspection.state === "active" || inspection.state === "verified-snapshot") {
            officialPolicyActivePairs += 1;
          } else {
            officialPolicyUncertainPairs += 1;
            console.warn(
              `Official policy check is uncertain for ${policy.label}: ` +
                `${inspection.reason}. Keeping the verified ${policy.verifiedAt} rule.`
            );
          }
        }

        if (!sameFullRule(currentRule, desiredRule)) {
          next.passports[passportId][destinationId] = desiredRule;
          officialPolicyChangedRules += 1;
          changedRules += 1;
          if (changes.length < 25) {
            changes.push(
              `${passportIso2} -> ${destinationIso2}: ` +
                `${currentRule.status}${currentRule.days ? `/${currentRule.days}` : ""} -> ` +
                `${desiredRule.status}${desiredRule.days ? `/${desiredRule.days}` : ""} ` +
                `[official policy: ${policy.id}; ${inspection.state}]`
            );
          }
        }
        continue;
      }

      const mobilityWatch = mobilityWatchesByKey.get(key);
      if (mobilityWatch) {
        const official = await inspectSpecialMobility(mobilityWatch);

        mobilityChecks.push(
          `${mobilityWatch.label}: ${official.state} (${official.reason})` +
            (official.sourceUrl ? ` [${official.sourceUrl}]` : "")
        );

        let desiredRule = currentRule;

        if (official.state === "freedom") {
          mobilityFreedom += 1;

          // Preserve existing metadata if the rule is already freedom so merely
          // re-checking the same policy does not create a new database version.
          if (currentRule.status !== "freedom") {
            desiredRule = {
              status: "freedom",
              source: mobilityWatch.source,
              sourceUrl:
                official.sourceUrl ??
                mobilityWatch.sourceUrl ??
                mobilityWatch.sourceUrls?.[0] ??
                "",
              updated: new Date().toISOString().slice(0, 10),
            };
          }
        } else if (official.state === "downgraded") {
          // A downgrade must also agree with the independent general feed. This
          // prevents a wording change on one official page from silently removing
          // a special mobility regime.
          if (normalized.status !== "freedom") {
            mobilityDowngraded += 1;
            desiredRule = normalized;
          } else {
            mobilityUncertain += 1;
            console.warn(
              `Official source suggests mobility downgrade for ${mobilityWatch.label}, ` +
                `but upstream still says freedom. Keeping current Borderly rule.`
            );
          }
        } else if (
          official.state === "neutral" &&
          currentRule.status !== "freedom"
        ) {
          // If a special regime was already removed in a previous run, keep
          // following the general feed while the official page stays neutral.
          desiredRule = normalized;
        } else {
          const bootstrapFrom = mobilityWatch.bootstrapFrom;
          const bootstrapMatches =
            mobilityWatch.bootstrapStatus &&
            bootstrapFrom &&
            currentRule.status === bootstrapFrom.status &&
            (bootstrapFrom.days == null ||
              currentRule.days === bootstrapFrom.days);

          if (bootstrapMatches) {
            desiredRule = {
              status: mobilityWatch.bootstrapStatus,
              source: mobilityWatch.source,
              sourceUrl:
                mobilityWatch.sourceUrl ??
                mobilityWatch.sourceUrls?.[0] ??
                "",
              updated:
                mobilityWatch.bootstrapVerifiedAt ??
                new Date().toISOString().slice(0, 10),
            };
            mobilityBootstrapped += 1;
            console.warn(
              `Special mobility bootstrap applied for ${mobilityWatch.label}: ` +
                `${currentRule.status}${currentRule.days ? `/${currentRule.days}` : ""} -> ` +
                `${desiredRule.status}. Live official fetch is unavailable, ` +
                `using the explicitly verified one-time migration.`
            );
          } else {
            mobilityUncertain += 1;
            console.warn(
              `Special mobility check unavailable/uncertain for ${mobilityWatch.label}: ` +
                `${official.reason}. Keeping current Borderly rule.`
            );
          }
        }

        if (!sameFullRule(currentRule, desiredRule)) {
          next.passports[passportId][destinationId] = desiredRule;
          mobilityChangedRules += 1;
          changedRules += 1;

          if (changes.length < 25) {
            changes.push(
              `${passportIso2} -> ${destinationIso2}: ` +
                `${currentRule.status}${currentRule.days ? `/${currentRule.days}` : ""} -> ` +
                `${desiredRule.status}${desiredRule.days ? `/${desiredRule.days}` : ""} ` +
                `[special mobility: ${official.state}]`
            );
          }
        }
        continue;
      }

      const watch = watchesByKey.get(key);
      if (watch) {
        const official = await inspectOfficialRestriction(watch);
        officialChecks.push(
          `${watch.label}: ${official.state} (${official.reason})` +
            (official.sourceUrl ? ` [${official.sourceUrl}]` : "")
        );

        const upstreamStillRestricted =
          normalized.status === "entry restricted" || normalized.status === "no admission";

        let desiredRule = currentRule;

        if (official.state === "restricted") {
          officialRestricted += 1;
          if (currentRule.status !== "entry restricted") {
            desiredRule = {
              status: "entry restricted",
              source: watch.source,
              sourceUrl: official.sourceUrl ?? watch.sourceUrl ?? watch.sourceUrls?.[0] ?? "",
              updated: new Date().toISOString().slice(0, 10),
            };
          }
        } else if (official.state === "released") {
          if (!upstreamStillRestricted) {
            officialReleased += 1;
            desiredRule = normalized;
          } else {
            officialUnknown += 1;
            console.warn(
              `Official source suggests release for ${watch.label}, but upstream still says ` +
                `${normalized.status}. Keeping current Borderly rule.`
            );
          }
        } else if (official.state === "neutral") {
          // Safe two-signal release: the known official page no longer carries a
          // restriction signal AND the independent Passport Index feed also moved
          // away from restricted/no-admission.
          if (!upstreamStillRestricted && currentRule.status === "entry restricted") {
            officialReleased += 1;
            desiredRule = normalized;
          } else if (currentRule.status !== "entry restricted") {
            // Once a watched restriction has been released, keep following the
            // normal upstream rule while the official page stays non-restrictive.
            desiredRule = normalized;
          } else {
            officialUnknown += 1;
          }
        } else {
          officialUnknown += 1;
          console.warn(
            `Official check unavailable/uncertain for ${watch.label}: ${official.reason}. ` +
              `Keeping current Borderly rule.`
          );
        }

        if (!sameFullRule(currentRule, desiredRule)) {
          next.passports[passportId][destinationId] = desiredRule;
          changedRules += 1;
          if (changes.length < 25) {
            changes.push(
              `${passportIso2} -> ${destinationIso2}: ` +
                `${currentRule.status}${currentRule.days ? `/${currentRule.days}` : ""} -> ` +
                `${desiredRule.status}${desiredRule.days ? `/${desiredRule.days}` : ""} ` +
                `[official watch: ${official.state}]`
            );
          }
        }
        continue;
      }

      if (hasManualOverride(currentRule)) {
        manualSnapshot.set(key, structuredClone(currentRule));
        continue;
      }

      const extendedPreferredRule =
        extendedByPassport?.get(passportIso2)?.get(destinationIso2);
      if (extendedPreferredRule) {
        // The 227-destination feed owns the category. Passport Index Data is
        // still useful for stay length, but it must not flip the category back
        // on every run when the two general feeds disagree.
        if (
          currentRule.status === extendedPreferredRule.status &&
          normalized.status === extendedPreferredRule.status &&
          !sameRule(currentRule, normalized)
        ) {
          next.passports[passportId][destinationId] = normalized;
          changedRules += 1;
        }
        continue;
      }

      if (preserveExtendedCategories) {
        if (
          currentRule.status === normalized.status &&
          !sameRule(currentRule, normalized)
        ) {
          next.passports[passportId][destinationId] = normalized;
          changedRules += 1;
        }
        continue;
      }

      if (!sameRule(currentRule, normalized)) {
        next.passports[passportId][destinationId] = normalized;
        changedRules += 1;
        if (changes.length < 25) {
          changes.push(
            `${passportIso2} -> ${destinationIso2}: ` +
              `${currentRule.status}${currentRule.days ? `/${currentRule.days}` : ""} -> ` +
              `${normalized.status}${normalized.days ? `/${normalized.days}` : ""}`
          );
        }
      }
    }
  }

  if (greenlandPolicy.state === "ready") {
    // Passports added during the 185 -> 199 migration have no previous
    // Greenland rule. Adding their officially classified rule is structural,
    // so it must not consume the safety budget for changing existing rules.
    for (const [passportId, rules] of Object.entries(current.passports ?? {})) {
      if (rules?.[GREENLAND_DESTINATION_NUMERIC]) continue;
      const officialGreenlandRule =
        greenlandPolicy.classifications.get(passportId);
      if (!officialGreenlandRule) continue;
      pendingGreenlandChanges.push({
        passportId,
        destinationId: GREENLAND_DESTINATION_NUMERIC,
        passportIso2: NUMERIC_TO_ISO2[passportId],
        destinationIso2: "GL",
        currentRule: undefined,
        desiredRule: {
          ...officialGreenlandRule,
          source: GREENLAND_SOURCE,
          sourceUrl: GREENLAND_COUNTRY_LIST_URL,
          updated: new Date().toISOString().slice(0, 10),
        },
      });
    }

    const existingGreenlandChanges = pendingGreenlandChanges.filter(
      (change) => change.currentRule !== undefined
    ).length;
    const greenlandChangesToApply =
      existingGreenlandChanges > MAX_GREENLAND_CHANGED_RULES
        ? pendingGreenlandChanges.filter(
            (change) => change.currentRule === undefined
          )
        : pendingGreenlandChanges;

    if (existingGreenlandChanges > MAX_GREENLAND_CHANGED_RULES) {
      console.warn(
        `Greenland safety stop: ${existingGreenlandChanges} existing rules would change ` +
          `(limit ${MAX_GREENLAND_CHANGED_RULES}). Keeping current Greenland rules.`
      );

      for (const [passportId, rules] of Object.entries(current.passports ?? {})) {
        const rule = rules?.[GREENLAND_DESTINATION_NUMERIC];
        if (!rule) continue;
        manualSnapshot.set(
          watchedKey(passportId, GREENLAND_DESTINATION_NUMERIC),
          structuredClone(rule)
        );
        greenlandProtectedRules += 1;
      }
    }

    for (const change of greenlandChangesToApply) {
      next.passports[change.passportId][change.destinationId] =
        change.desiredRule;
      greenlandChangedRules += 1;
      changedRules += 1;

      if (changes.length < 25) {
        const previous = change.currentRule
          ? `${change.currentRule.status}${
              change.currentRule.days ? `/${change.currentRule.days}` : ""
            }`
          : "missing";
        changes.push(
          `${change.passportIso2} -> ${change.destinationIso2}: ` +
            `${previous} -> ` +
            `${change.desiredRule.status}${change.desiredRule.days ? `/${change.desiredRule.days}` : ""} ` +
            `[official Greenland policy]`
        );
      }
    }
  }

  const extension = applyExtendedDestinations(next, extendedByPassport);
  next = extension.database;

  if (missingPassports > 0) {
    throw new Error(`Upstream is missing ${missingPassports} supported passports`);
  }
  if (sourceCoveredRules < 30000) {
    throw new Error(`Upstream coverage is unexpectedly low: ${sourceCoveredRules} rules`);
  }
  if (missingRules > 500) {
    throw new Error(`Too many source rules are missing: ${missingRules}`);
  }
  if (changedRules > MAX_CHANGED_RULES) {
    throw new Error(
      `Safety stop: ${changedRules} rules changed at once (limit ${MAX_CHANGED_RULES})`
    );
  }

  if (officialChecks.length !== officialWatches.length) {
    throw new Error(
      `Official watch coverage mismatch: checked ${officialChecks.length} of ${officialWatches.length}`
    );
  }

  if (mobilityChecks.length !== mobilityWatches.length) {
    throw new Error(
      `Special mobility coverage mismatch: checked ${mobilityChecks.length} of ${mobilityWatches.length}`
    );
  }

  if (officialPolicyChecks.length !== officialRulePolicies.length) {
    throw new Error(
      `Official policy coverage mismatch: checked ${officialPolicyChecks.length} of ` +
        `${officialRulePolicies.length}`
    );
  }

  validateDatabase(next, manualSnapshot);

  console.log(
    `Greenland visa policy: ${greenlandPolicy.state} ` +
      `(recognized=${greenlandPolicy.recognized}, ` +
      `biometric-overlap=${greenlandPolicy.duplicateVisaClasses ?? 0}, ` +
      `changed=${greenlandChangedRules}, protected=${greenlandProtectedRules})`
  );
  console.log(`  ${greenlandPolicy.reason}`);
  console.log(`  ${GREENLAND_ENTRY_URL}`);
  console.log(`  ${GREENLAND_COUNTRY_LIST_URL}`);

  console.log("Special mobility watches:");
  for (const check of mobilityChecks) console.log(`  ${check}`);
  console.log(
    `Special mobility summary: freedom=${mobilityFreedom}, downgraded=${mobilityDowngraded}, ` +
      `uncertain=${mobilityUncertain}, bootstrapped=${mobilityBootstrapped}, ` +
      `changed=${mobilityChangedRules}`
  );

  console.log("Official entry watches:");
  for (const check of officialChecks) console.log(`  ${check}`);
  console.log(
    `Official summary: restricted=${officialRestricted}, released=${officialReleased}, ` +
      `uncertain=${officialUnknown}`
  );

  console.log("Official rule policies:");
  for (const check of officialPolicyChecks) console.log(`  ${check}`);
  console.log(
    `Official policy summary: configuredPairs=${officialPoliciesByKey.size}, ` +
      `active=${officialPolicyActivePairs}, releasedOrExpired=${officialPolicyReleasedPairs}, ` +
      `uncertain=${officialPolicyUncertainPairs}, changed=${officialPolicyChangedRules}`
  );

  const metadataNeedsUpdate =
    next.source !== "Borderly Extended Visa Data" ||
    next.destinationCount !== EXPECTED_DESTINATIONS ||
    !Array.isArray(next.sources) ||
    next.sources.length !== 3;

  if (
    changedRules === 0 &&
    expansion.addedRules === 0 &&
    extension.addedRules === 0 &&
    extension.changedRules === 0 &&
    extension.removedRules === 0 &&
    !metadataNeedsUpdate
  ) {
    console.log("No visa-rule changes found. Nothing to publish.");
    fs.writeFileSync("update_result.txt", "no_changes\n");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  next.source = "Borderly Extended Visa Data";
  next.sourceUrl = SOURCE_REPO;
  next.destinationCount = EXPECTED_DESTINATIONS;
  next.sources = [
    {
      name: "Passport Index Data",
      url: SOURCE_REPO,
      coverage: "199 passport-issuing destinations and stay lengths",
    },
    {
      name: "Global Passport Power Rankings & Visa Requirements",
      url: "https://www.kaggle.com/datasets/ngshiheng/henley-passport-index-visa-requirements",
      coverage: "227-destination requirement categories",
      license: "CC BY-NC 4.0",
    },
    {
      name: "Borderly territory derivations",
      coverage: "19 ISO territories absent from the 227-destination feed",
    },
  ];
  next.updated = today;

  const nextVersion = Math.max(Number(version.version) || 0, 0) + 1;
  const nextVersionManifest = {
    ...version,
    version: nextVersion,
    updated: today,
    database: DATABASE_FILE,
  };

  fs.writeFileSync(databasePath, JSON.stringify(next, null, 2) + "\n");
  fs.writeFileSync(versionPath, JSON.stringify(nextVersionManifest, null, 2) + "\n");
  fs.writeFileSync("update_result.txt", "updated\n");

  console.log(`Published candidate version: ${nextVersion}`);
  console.log(`Added passports: ${expansion.addedPassports}`);
  console.log(`Added matrix rules: ${expansion.addedRules}`);
  console.log(`Added extended rules: ${extension.addedRules}`);
  console.log(`Changed extended rules: ${extension.changedRules}`);
  console.log(`Removed obsolete/self rules: ${extension.removedRules}`);
  console.log(`Changed rules: ${changedRules}`);
  console.log(`Greenland official changes: ${greenlandChangedRules}`);
  console.log(`Special mobility changes: ${mobilityChangedRules}`);
  console.log(`Official policy changes: ${officialPolicyChangedRules}`);
  console.log(`Protected manual overrides: ${manualSnapshot.size}`);
  console.log(`Source-covered rules: ${sourceCoveredRules}`);
  for (const change of changes) console.log(`  ${change}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
