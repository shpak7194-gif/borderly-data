import fs from "node:fs";

const isoFile = process.env.ISO_COUNTRIES_FILE;
const passportFile = process.env.PASSPORT_INDEX_FILE;
if (!isoFile || !passportFile) {
  throw new Error("Set ISO_COUNTRIES_FILE and PASSPORT_INDEX_FILE");
}

const isoCountries = JSON.parse(fs.readFileSync(isoFile, "utf8"));
const passportCodes = new Set(
  Object.keys(JSON.parse(fs.readFileSync(passportFile, "utf8")))
);
const excluded = new Set(["AQ", "BV"]);
const destinations = isoCountries
  .filter(
    (country) =>
      country.cca2 && country.ccn3 && !excluded.has(country.cca2)
  )
  .map((country) => {
    const sourceKind = passportCodes.has(country.cca2)
      ? "passport-index-core"
      : "territory-registry";

    return {
      numeric: String(Number(country.ccn3)),
      iso2: country.cca2,
      name: country.name.common,
      sourceKind,
    };
  });

destinations.push({
  numeric: "983",
  iso2: "XK",
  name: "Kosovo",
  sourceKind: passportCodes.has("XK")
    ? "passport-index-core"
    : "territory-registry",
});

destinations.sort((left, right) => Number(left.numeric) - Number(right.numeric));

const numericIds = new Set(destinations.map((destination) => destination.numeric));
const iso2Ids = new Set(destinations.map((destination) => destination.iso2));
if (destinations.length !== 248 || numericIds.size !== 248 || iso2Ids.size !== 248) {
  throw new Error(
    `Expected 248 unique destinations, found ${destinations.length} ` +
      `(numeric=${numericIds.size}, iso2=${iso2Ids.size})`
  );
}

const manifest = {
  version: 1,
  destinationCount: destinations.length,
  excluded: [
    { iso2: "AQ", name: "Antarctica", reason: "No ordinary tourist border regime" },
    { iso2: "BV", name: "Bouvet Island", reason: "Uninhabited nature reserve" },
  ],
  destinations,
};

fs.writeFileSync("destinations.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${destinations.length} destinations to destinations.json`);
