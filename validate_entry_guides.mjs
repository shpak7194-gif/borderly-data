import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('entry_guides.json', 'utf8'));
const version = JSON.parse(fs.readFileSync('entry_guides_version.json', 'utf8'));

if (data.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
if (!Number.isInteger(data.version) || data.version < 1) throw new Error('invalid data version');
if (version.version !== data.version) throw new Error('version files do not match');
if (version.schemaVersion !== 1) throw new Error('unsupported entry guide release schema');
if (version.database !== `releases/entry_guides_v${version.version}.json`) {
  throw new Error('entry guide database must use an immutable versioned filename');
}
if (!Array.isArray(data.guides) || data.guides.length < 4) throw new Error('too few guides');

const pairs = new Set();
for (const guide of data.guides) {
  const key = `${guide.passportIso}->${guide.destinationIso}`;
  if (pairs.has(key)) throw new Error(`duplicate guide ${key}`);
  pairs.add(key);
  if (!Array.isArray(guide.visaTypes) || guide.visaTypes.length < 1) throw new Error(`missing visaTypes ${key}`);
  if (!Array.isArray(guide.steps) || guide.steps.length < 1) throw new Error(`missing steps ${key}`);
  if (!Array.isArray(guide.documents) || guide.documents.length < 1) throw new Error(`missing documents ${key}`);
  if (!Array.isArray(guide.links) || guide.links.length < 1) throw new Error(`missing links ${key}`);
  const primary = guide.links.filter(x => x.primary === true);
  if (primary.length !== 1) throw new Error(`guide ${key} must have exactly one primary link`);
  for (const link of guide.links) {
    const url = new URL(link.url);
    if (url.protocol !== 'https:') throw new Error(`non-https link ${key}`);
  }
}

console.log(`OK: ${data.guides.length} guides, version ${data.version}`);
