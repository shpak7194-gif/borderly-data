import crypto from "node:crypto";

export function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );
}

export function normalizeOfficialBody(value, contentType = "text/html") {
  let normalized = String(value ?? "").normalize("NFKC");
  if (contentType.includes("html") || /<html\b|<body\b/i.test(normalized)) {
    normalized = normalized
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ");
  }
  return decodeHtmlEntities(normalized)
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, "[clock]")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizedSha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function challengeReason(normalizedText) {
  const patterns = [
    ["captcha", /\bcaptcha\b/i],
    ["human-verification", /verify (?:that )?you are human|are you a robot/i],
    ["access-denied", /access denied|request blocked|automated-access challenge/i],
    ["cloudflare-challenge", /cloudflare ray id|cf-chl-/i],
  ];
  return patterns.find(([, pattern]) => pattern.test(normalizedText))?.[0] ?? null;
}

export function evaluateMarkerGroups(normalizedText, markerGroups) {
  const missingGroups = [];
  for (const group of markerGroups ?? []) {
    if (!group.some((marker) => normalizedText.includes(marker.toLowerCase()))) {
      missingGroups.push(group);
    }
  }
  return {
    ok: missingGroups.length === 0,
    missingGroups,
  };
}

export function assessOfficialSource({ source, fetched, baseline }) {
  if (!fetched || fetched.state === "unavailable") {
    return {
      state: "unavailable",
      reviewRequired: true,
      error: fetched?.error ?? "source unavailable",
    };
  }
  if (fetched.state === "blocked") {
    return {
      state: "blocked",
      reviewRequired: true,
      error: fetched.error,
    };
  }
  const markers = evaluateMarkerGroups(
    fetched.normalizedText,
    source.requiredMarkerGroups
  );
  if (!markers.ok) {
    return {
      state: "invalid-content",
      reviewRequired: true,
      missingMarkerGroups: markers.missingGroups,
    };
  }
  if (!baseline) {
    return {
      state: "baseline-missing",
      reviewRequired: true,
    };
  }
  if (
    baseline.normalizedSha256 !== fetched.normalizedSha256 ||
    baseline.finalUrl !== fetched.finalUrl
  ) {
    return {
      state: "changed",
      reviewRequired: true,
      previousSha256: baseline.normalizedSha256,
      previousFinalUrl: baseline.finalUrl,
    };
  }
  return {
    state: "unchanged",
    reviewRequired: false,
  };
}

export function evaluatePolicyWindow(policy, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today ?? ""))) {
    throw new Error(`Invalid policy evaluation date: ${today}`);
  }
  if (policy.validFrom && today < policy.validFrom) {
    return { state: "scheduled", boundary: policy.validFrom };
  }
  if (policy.validUntil && today > policy.validUntil) {
    return { state: "expired", boundary: policy.validUntil };
  }
  return { state: "active", boundary: null };
}
