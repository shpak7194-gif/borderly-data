import fs from "node:fs";

const db = JSON.parse(fs.readFileSync("visa_requirements.json", "utf8"));
const registry = JSON.parse(fs.readFileSync("freedom_registry.json", "utf8"));
const entries = registry.entries ?? [];
const key = (p, d) => `${p}:${d}`;
const map = new Map(entries.map((e) => [key(e.passportNumeric, e.destinationNumeric), e]));
if (map.size !== entries.length) throw new Error("Duplicate freedom registry pairs");
if (entries.length < 1100) throw new Error(`Freedom registry unexpectedly small: ${entries.length}`);
for (const [k, e] of map) {
  const [p, d] = k.split(":");
  const rule = db.passports?.[p]?.[d];
  if (rule?.status !== "freedom") throw new Error(`${k}: registry expects freedom, found ${rule?.status ?? "missing"}`);
  if (!rule.source || !rule.sourceUrl || !rule.updated) throw new Error(`${k}: freedom rule lacks authoritative metadata`);
}
const expected = [
  ["276", "250", "freedom"],
  ["578", "752", "freedom"],
  ["756", "276", "freedom"],
  ["643", "112", "freedom"],
  ["643", "762", "visa free"],
];
for (const [p,d,status] of expected) {
  const actual=db.passports?.[p]?.[d]?.status;
  if (actual !== status) throw new Error(`${p}:${d}: expected ${status}, found ${actual}`);
}
for (const [p, row] of Object.entries(db.passports ?? {})) {
  for (const [d, rule] of Object.entries(row ?? {})) {
    if (rule?.status === "freedom" && !map.has(key(p,d))) throw new Error(`${p}:${d}: unregistered freedom`);
  }
}
console.log(`Data v9 freedom registry OK: ${entries.length} authoritative pairs`);
