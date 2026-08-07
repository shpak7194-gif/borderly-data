import fs from "node:fs";
import path from "node:path";

const UPSTREAM_URL =
  "https://raw.githubusercontent.com/imorte/passport-index-data/refs/heads/main/passport-index.json";
const SOURCE_REPO = "https://github.com/imorte/passport-index-data";
const DATABASE_FILE = "visa_requirements.json";
const VERSION_FILE = "version.json";
const OFFICIAL_WATCHES_FILE = "official_entry_watches.json";
const OFFICIAL_FETCH_TIMEOUT_MS = 15000;
const MAX_CHANGED_RULES = 2500;
const MIN_PASSPORTS = 180;
const MIN_RULES_PER_PASSPORT = 180;

const NUMERIC_TO_ISO2 = {"100":"BG","104":"MM","108":"BI","112":"BY","116":"KH","12":"DZ","120":"CM","124":"CA","132":"CV","136":"KY","140":"CF","144":"LK","148":"TD","152":"CL","156":"CN","158":"TW","170":"CO","174":"KM","178":"CG","180":"CD","188":"CR","191":"HR","192":"CU","196":"CY","20":"AD","203":"CZ","204":"BJ","208":"DK","212":"DM","214":"DO","218":"EC","222":"SV","226":"GQ","231":"ET","232":"ER","233":"EE","234":"FO","238":"FK","239":"GS","24":"AO","242":"FJ","246":"FI","248":"AX","250":"FR","258":"PF","260":"TF","262":"DJ","266":"GA","268":"GE","270":"GM","275":"PS","276":"DE","288":"GH","296":"KI","300":"GR","304":"GL","31":"AZ","316":"GU","32":"AR","320":"GT","324":"GN","328":"GY","332":"HT","334":"HM","340":"HN","344":"HK","348":"HU","352":"IS","356":"IN","36":"AU","360":"ID","364":"IR","368":"IQ","372":"IE","376":"IL","380":"IT","384":"CI","388":"JM","392":"JP","398":"KZ","4":"AF","40":"AT","400":"JO","404":"KE","408":"KP","410":"KR","414":"KW","417":"KG","418":"LA","422":"LB","426":"LS","428":"LV","430":"LR","434":"LY","438":"LI","44":"BS","440":"LT","442":"LU","450":"MG","454":"MW","458":"MY","466":"ML","470":"MT","478":"MR","48":"BH","480":"MU","484":"MX","496":"MN","498":"MD","499":"ME","50":"BD","504":"MA","508":"MZ","51":"AM","512":"OM","516":"NA","52":"BB","524":"NP","528":"NL","531":"CW","540":"NC","548":"VU","554":"NZ","558":"NI","56":"BE","562":"NE","566":"NG","578":"NO","584":"MH","585":"PW","586":"PK","591":"PA","598":"PG","600":"PY","604":"PE","608":"PH","616":"PL","620":"PT","624":"GW","626":"TL","630":"PR","634":"QA","64":"BT","642":"RO","643":"RU","646":"RW","659":"KN","666":"PM","678":"ST","68":"BO","682":"SA","686":"SN","688":"RS","694":"SL","70":"BA","702":"SG","703":"SK","704":"VN","705":"SI","706":"SO","710":"ZA","716":"ZW","72":"BW","724":"ES","728":"SS","729":"SD","732":"EH","740":"SR","748":"SZ","752":"SE","756":"CH","76":"BR","760":"SY","762":"TJ","764":"TH","768":"TG","780":"TT","784":"AE","788":"TN","792":"TR","795":"TM","8":"AL","800":"UG","804":"UA","807":"MK","818":"EG","826":"GB","833":"IM","834":"TZ","84":"BZ","840":"US","854":"BF","858":"UY","860":"UZ","862":"VE","882":"WS","887":"YE","894":"ZM","90":"SB","96":"BN","983":"XK"};

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

async function loadOfficialPage(watch) {
  if (process.env.OFFICIAL_FIXTURE_DIR) {
    const fixturePath = path.join(
      process.env.OFFICIAL_FIXTURE_DIR,
      `${watch.id}.html`
    );
    return fs.readFileSync(fixturePath, "utf8");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OFFICIAL_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(watch.sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Borderly-Official-Entry-Watch/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectOfficialRestriction(watch) {
  try {
    const html = await loadOfficialPage(watch);
    const text = htmlToText(html);

    if (!matchesAllMarkers(text, watch.pageMarkers ?? [])) {
      return {
        state: "unknown",
        reason: "official page markers were not found",
      };
    }

    const restricted = matchesAny(text, watch.restrictedPatterns ?? []);
    const released = matchesAny(text, watch.releasePatterns ?? []);

    // Explicit release wording wins over historical restriction wording. Official
    // pages often keep the old policy text when announcing that it was lifted.
    if (released) {
      return { state: "released", reason: "official release signal found" };
    }

    if (restricted) {
      return { state: "restricted", reason: "official restriction signal found" };
    }

    return {
      state: "neutral",
      reason: "official page is recognized but has no known restriction signal",
    };
  } catch (error) {
    return {
      state: "error",
      reason: error?.message || String(error),
    };
  }
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
  const current = readJson(databasePath);
  const version = readJson(versionPath);
  const upstream = await loadUpstream();
  const officialWatches = readJson(path.resolve(OFFICIAL_WATCHES_FILE)).watches ?? [];
  const watchesByKey = new Map(
    officialWatches.map((watch) => [
      watchedKey(watch.passportNumeric, watch.destinationNumeric),
      watch,
    ])
  );

  const next = structuredClone(current);
  const manualSnapshot = new Map();
  let sourceCoveredRules = 0;
  let missingPassports = 0;
  let missingRules = 0;
  let changedRules = 0;
  let officialRestricted = 0;
  let officialReleased = 0;
  let officialUnknown = 0;
  const changes = [];
  const officialChecks = [];

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
      const upstreamRule = destinationIso2 ? upstreamRules[destinationIso2] : undefined;
      if (!upstreamRule) {
        missingRules += 1;
        continue;
      }

      sourceCoveredRules += 1;
      const normalized = stableRule(upstreamRule);
      if (!ALLOWED_STATUSES.has(normalized.status)) {
        throw new Error(
          `Unknown upstream status ${normalized.status} for ${passportIso2} -> ${destinationIso2}`
        );
      }

      const watch = watchesByKey.get(key);
      if (watch) {
        const official = await inspectOfficialRestriction(watch);
        officialChecks.push(`${watch.label}: ${official.state} (${official.reason})`);

        const upstreamStillRestricted =
          normalized.status === "entry restricted" || normalized.status === "no admission";

        let desiredRule = currentRule;

        if (official.state === "restricted") {
          officialRestricted += 1;
          if (currentRule.status !== "entry restricted") {
            desiredRule = {
              status: "entry restricted",
              source: watch.source,
              sourceUrl: watch.sourceUrl,
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

  validateDatabase(next, manualSnapshot);

  console.log("Official entry watches:");
  for (const check of officialChecks) console.log(`  ${check}`);
  console.log(
    `Official summary: restricted=${officialRestricted}, released=${officialReleased}, ` +
      `uncertain=${officialUnknown}`
  );

  if (changedRules === 0) {
    console.log("No visa-rule changes found. Nothing to publish.");
    fs.writeFileSync("update_result.txt", "no_changes\n");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  next.source = "Passport Index Data";
  next.sourceUrl = SOURCE_REPO;
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
  console.log(`Changed rules: ${changedRules}`);
  console.log(`Protected non-watched manual overrides: ${manualSnapshot.size}`);
  console.log(`Source-covered rules: ${sourceCoveredRules}`);
  for (const change of changes) console.log(`  ${change}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
