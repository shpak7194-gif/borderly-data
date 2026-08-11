import fs from 'node:fs';

const visa = JSON.parse(fs.readFileSync('visa_requirements.json', 'utf8'));
const entry = JSON.parse(fs.readFileSync('entry_requirements.json', 'utf8'));

function visaRule(passport, destination) {
  return visa.passports[String(passport)]?.[String(destination)];
}
function requirement(id) {
  return entry.requirements.find(item => item.id === id);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ruMy = visaRule(643, 458);
const ruCn = visaRule(643, 156);
const aeRu = visaRule(784, 643);

assert(ruMy?.status === 'visa free', 'RU->MY must remain visa free');
assert(ruCn?.status === 'visa free', 'RU->CN must remain visa free');
assert(aeRu?.status === 'visa free' && aeRu?.days === 90, 'AE->RU must be visa free for 90 days, not ETA');
assert(requirement('ru-my-mdac')?.type === 'arrival_card', 'RU->MY MDAC regression missing');
assert(requirement('ru-cn-arrival-card')?.type === 'arrival_card', 'RU->CN Arrival Card regression missing');
assert(requirement('ae-ru-ruid')?.type === 'pre_travel_registration', 'AE->RU ruID regression missing');
assert(requirement('ae-ru-ruid')?.visaTypes?.includes('visa_free'), 'ruID must attach to visa-free status');

for (const item of entry.requirements) {
  for (const forbidden of ['status', 'visaType', 'visaStatus', 'days', 'stayDays', 'mapCategory']) {
    assert(!(forbidden in item), `${item.id} must not be able to redefine visa category via ${forbidden}`);
  }
}

console.log('Entry-requirement safety regressions passed.');
