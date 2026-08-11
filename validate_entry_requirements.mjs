import fs from 'node:fs';
import { URL } from 'node:url';

const payload = JSON.parse(fs.readFileSync('entry_requirements.json', 'utf8'));
const version = JSON.parse(fs.readFileSync('entry_requirements_version.json', 'utf8'));
const visa = JSON.parse(fs.readFileSync('visa_requirements.json', 'utf8'));

const allowedVisaTypes = new Set([
  'freedom', 'visa_free', 'eta', 'visa_on_arrival', 'e_visa',
  'visa_required', 'entry_restricted', 'no_data'
]);
const allowedTypes = new Set([
  'arrival_card', 'pre_travel_registration', 'health_declaration',
  'customs_declaration', 'tourism_registration', 'other_entry_formality'
]);
const forbiddenVisaFields = new Set([
  'status', 'visaType', 'visaStatus', 'days', 'stayDays', 'color', 'mapCategory'
]);
const mapVisaType = (status) => ({
  'freedom': 'freedom',
  'visa free': 'visa_free',
  'eta': 'eta',
  'visa on arrival': 'visa_on_arrival',
  'e-visa': 'e_visa',
  'visa required': 'visa_required',
  'entry restricted': 'entry_restricted',
  'no admission': 'entry_restricted'
}[status] ?? 'no_data');

function requireText(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`Invalid ${label}`);
  }
}

if (payload.schemaVersion !== 1) throw new Error('Unsupported entry requirement schemaVersion');
if (!Number.isInteger(payload.version) || payload.version <= 0) throw new Error('Invalid entry requirement version');
if (version.version !== payload.version) throw new Error('entry_requirements version mismatch');
if (version.database !== 'entry_requirements.json') throw new Error('entry_requirements_version database mismatch');
if (!Array.isArray(payload.requirements)) throw new Error('Missing requirements array');

const ids = new Set();
const pairTypeKeys = new Set();
for (const item of payload.requirements) {
  for (const field of forbiddenVisaFields) {
    if (Object.hasOwn(item, field)) {
      throw new Error(`${item.id ?? 'unknown'} contains forbidden visa field ${field}`);
    }
  }
  requireText(item.id, 'id', 120);
  if (ids.has(item.id)) throw new Error(`Duplicate requirement id ${item.id}`);
  ids.add(item.id);

  if (!Number.isInteger(item.passportIso) || item.passportIso < 1 || item.passportIso > 999) {
    throw new Error(`Invalid passportIso for ${item.id}`);
  }
  if (!Number.isInteger(item.destinationIso) || item.destinationIso < 1 || item.destinationIso > 999) {
    throw new Error(`Invalid destinationIso for ${item.id}`);
  }
  if (item.passportIso === item.destinationIso) throw new Error(`Home-country requirement ${item.id}`);
  if (!allowedTypes.has(item.type)) throw new Error(`Unknown requirement type ${item.type}`);
  if (!Array.isArray(item.visaTypes) || item.visaTypes.length < 1 || item.visaTypes.some(v => !allowedVisaTypes.has(v))) {
    throw new Error(`Invalid visaTypes for ${item.id}`);
  }

  requireText(item.title, `${item.id}.title`, 240);
  requireText(item.summary, `${item.id}.summary`, 1200);
  requireText(item.timing, `${item.id}.timing`, 500);
  requireText(item.officialAuthority, `${item.id}.officialAuthority`, 240);
  requireText(item.sourceUrl, `${item.id}.sourceUrl`, 2048);
  requireText(item.verified, `${item.id}.verified`, 32);
  if (item.mandatory !== true && item.mandatory !== false) throw new Error(`Invalid mandatory for ${item.id}`);
  if (!Array.isArray(item.steps) || item.steps.length < 1 || item.steps.length > 12) {
    throw new Error(`Invalid steps for ${item.id}`);
  }
  for (const step of item.steps) requireText(step, `${item.id}.step`, 600);
  const url = new URL(item.sourceUrl);
  if (url.protocol !== 'https:') throw new Error(`Only HTTPS is allowed for ${item.id}`);

  const passportRules = visa.passports?.[String(item.passportIso)];
  const visaRule = passportRules?.[String(item.destinationIso)];
  if (!visaRule) throw new Error(`Missing visa rule for ${item.passportIso}->${item.destinationIso}`);
  const currentType = mapVisaType(visaRule.status);
  if (!item.visaTypes.includes(currentType)) {
    throw new Error(`${item.id} is incompatible with current visa status ${visaRule.status}`);
  }

  const key = `${item.passportIso}:${item.destinationIso}:${item.type}`;
  if (pairTypeKeys.has(key)) throw new Error(`Duplicate pair/type ${key}`);
  pairTypeKeys.add(key);
}

console.log(`Entry requirements valid: ${payload.requirements.length} verified pair-specific formalities.`);
