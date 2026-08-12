import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "extended-source");
const requiredHeaders = new Set([
  "from_country_code",
  "to_country_code",
  "requirement_type",
]);

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(target) : [target];
  });
}

const candidates = filesIn(root)
  .filter((file) => file.toLowerCase().endsWith(".csv"))
  .filter((file) => {
    const descriptor = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(16 * 1024);
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
      const header = buffer.subarray(0, count).toString("utf8").split(/\r?\n/, 1)[0];
      const columns = new Set(header.split(",").map((value) => value.replaceAll('"', "").trim()));
      return [...requiredHeaders].every((column) => columns.has(column));
    } finally {
      fs.closeSync(descriptor);
    }
  });

if (candidates.length !== 1) {
  throw new Error(
    `Expected exactly one extended CSV with the Borderly columns, found ${candidates.length}: ` +
      candidates.join(", ")
  );
}

console.log(candidates[0]);
