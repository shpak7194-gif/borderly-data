import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RELEASE_SCHEMA_VERSION = 1;

export function jsonText(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function immutableReleasePath(prefix, version) {
  if (!/^[a-z0-9_]+$/.test(prefix)) {
    throw new Error(`Invalid release prefix: ${prefix}`);
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Invalid release version: ${version}`);
  }
  return `releases/${prefix}_v${version}.json`;
}

export function writeImmutableRelease({ prefix, version, text, baseDir = "." }) {
  const relativePath = immutableReleasePath(prefix, version);
  const target = path.resolve(baseDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target, "utf8");
    if (existing !== text) {
      throw new Error(
        `${relativePath} already exists with different content; immutable releases cannot be overwritten`
      );
    }
  } else {
    fs.writeFileSync(target, text);
  }

  return {
    relativePath,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

export function safeReleaseFile(baseDir, relativePath) {
  if (
    typeof relativePath !== "string" ||
    !/^releases\/[a-z0-9_]+_v[1-9][0-9]*\.json$/.test(relativePath)
  ) {
    throw new Error(`Unsafe or non-versioned release path: ${relativePath}`);
  }
  const root = path.resolve(baseDir, "releases");
  const resolved = path.resolve(baseDir, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Release path escapes releases directory: ${relativePath}`);
  }
  return resolved;
}
