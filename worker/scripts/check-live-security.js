#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 12_000;
const ACCESS_HOST_PATTERN = /(^|\.)cloudflareaccess\.com$/i;
const ADMIN_DENY_MESSAGES = new Set([
  "Missing Cloudflare Access token",
  "Invalid Cloudflare Access token",
  "Expired Cloudflare Access token",
  "Cloudflare Access token is not active",
  "Unknown Cloudflare Access signing key",
  "Forbidden",
]);

const { baseUrl, timeoutMs } = parseArgs(process.argv.slice(2));

const checks = [
  protectedAdmin("admin page", "GET", "/admin"),
  protectedAdmin("admin config", "GET", "/admin/config"),
  protectedAdmin("admin page method probe", "POST", "/admin"),
  protectedAdmin("admin config method probe", "DELETE", "/admin/config"),
  protectedAdmin("admin config unauthenticated write", "PUT", "/admin/config", {
    "content-type": "application/json",
  }, "{}"),
  protectedAdmin("admin config CORS preflight", "OPTIONS", "/admin/config", {
    origin: "https://example.test",
    "access-control-request-method": "PUT",
  }),
  protectedAdmin("admin query token ignored", "GET", "/admin?admin_token=admin-token"),
  protectedAdmin("config query token ignored", "GET", "/admin/config?admin_token=admin-token"),
  protectedAdmin("admin authorization ignored", "GET", "/admin", {
    authorization: "Bearer admin-token",
  }),
  protectedAdmin("config authorization ignored", "GET", "/admin/config", {
    authorization: "Bearer admin-token",
  }),
  protectedAdmin("admin fake Access JWT rejected", "GET", "/admin", {
    "cf-access-jwt-assertion": "bogus",
  }),
  protectedAdmin("config fake Access JWT rejected", "GET", "/admin/config", {
    "cf-access-jwt-assertion": "bogus",
  }),
  protectedAdmin("admin trailing slash", "GET", "/admin/"),
  protectedAdmin("config trailing slash", "GET", "/admin/config/"),
  retiredRoute("retired admin page", "/atlas"),
  retiredRoute("retired admin config", "/atlas/config"),
  unauthorizedRoute("subscription without token", "/atlas-router"),
  unauthorizedRoute("subscription invalid token", "/atlas-router?token=invalid-token"),
  unauthorizedRoute("subscription admin token ignored", "/atlas-router?admin_token=admin-token"),
  unauthorizedRoute("subscription fallback headers ignored", "/atlas-router", {
    authorization: "Bearer admin-token",
    "cf-access-jwt-assertion": "bogus",
  }),
  unauthorizedRoute("module without token", "/modules/skip-proxy-lists.sgmodule"),
  unauthorizedRoute("module fallback headers ignored", "/modules/skip-proxy-lists.sgmodule", {
    authorization: "Bearer admin-token",
    "cf-access-jwt-assertion": "bogus",
  }),
];

let failures = 0;
console.log(`Live security target: ${baseUrl}`);

for (const check of checks) {
  const result = await request(check, timeoutMs);
  const verdict = check.assert(result);
  const line = [
    verdict.ok ? "PASS" : "FAIL",
    check.name,
    `${check.method} ${check.path}`,
    `status=${result.status}`,
    result.locationHost ? `location=${result.locationHost}` : "",
  ].filter(Boolean).join(" | ");

  console.log(line);
  if (!verdict.ok) {
    failures += 1;
    console.log(`  ${verdict.message}`);
    console.log(`  body: ${summarizeBody(result.body)}`);
  }
}

if (failures > 0) {
  console.error(`Live security check failed: ${failures}/${checks.length} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`Live security check passed: ${checks.length}/${checks.length} checks passed.`);
}

function parseArgs(args) {
  let nextBaseUrl = process.env.ATLAS_ROUTER_BASE_URL || "";
  let nextTimeoutMs = DEFAULT_TIMEOUT_MS;

  for (const arg of args) {
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--timeout-ms=")) {
      nextTimeoutMs = Number(arg.slice("--timeout-ms=".length));
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      nextBaseUrl = arg.slice("--base-url=".length);
      continue;
    }
    if (!arg.startsWith("-")) {
      nextBaseUrl = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(nextTimeoutMs) || nextTimeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  if (!nextBaseUrl) {
    throw new Error("Missing target base URL. Pass it as an argument, --base-url=<url>, or ATLAS_ROUTER_BASE_URL.");
  }

  return {
    baseUrl: normalizeBaseUrl(nextBaseUrl),
    timeoutMs: nextTimeoutMs,
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/check-live-security.js [base-url]
  npm run check:live-security -- [base-url]

Options:
  --base-url=<url>      Target site. Can also be set with ATLAS_ROUTER_BASE_URL
  --timeout-ms=<ms>     Per-request timeout. Defaults to ${DEFAULT_TIMEOUT_MS}

This script performs unauthenticated, non-mutating live security probes. It is
not wired into npm test and must be run explicitly.`);
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function protectedAdmin(name, method, path, headers = {}, body = undefined) {
  return {
    name,
    method,
    path,
    headers,
    body,
    assert: assertProtectedAdmin,
  };
}

function retiredRoute(name, path) {
  return {
    name,
    method: "GET",
    path,
    assert(result) {
      if (result.status !== 404) {
        return fail(`expected 404 for retired route, got ${result.status}`);
      }
      if (result.body.trim() !== "Not Found") {
        return fail("retired route did not return Not Found");
      }
      return pass();
    },
  };
}

function unauthorizedRoute(name, path, headers = {}) {
  return {
    name,
    method: "GET",
    path,
    headers,
    assert(result) {
      if (result.status !== 401) {
        return fail(`expected 401 for unauthorized subscription/module route, got ${result.status}`);
      }
      if (result.body.trim() !== "Unauthorized") {
        return fail("unauthorized route did not return Unauthorized");
      }
      return pass();
    },
  };
}

async function request(check, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${baseUrl}${check.path}`;
  try {
    const response = await fetch(url, {
      method: check.method,
      headers: check.headers,
      body: check.body,
      redirect: "manual",
      signal: controller.signal,
    });
    const body = await response.text();
    const location = response.headers.get("location") || "";
    return {
      body,
      location,
      locationHost: locationHost(location),
      status: response.status,
    };
  } catch (error) {
    return {
      body: error instanceof Error ? error.message : String(error),
      location: "",
      locationHost: "",
      status: "ERROR",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertProtectedAdmin(result) {
  if (leaksProtectedContent(result.body)) {
    return fail("response body appears to contain protected AtlasRouter content");
  }
  if (isAccessRedirect(result)) {
    return pass();
  }
  if (result.status === 403 && ADMIN_DENY_MESSAGES.has(result.body.trim())) {
    return pass();
  }
  if (result.status === 403 && /\bForbidden\b/i.test(result.body)) {
    return pass();
  }
  return fail("expected Cloudflare Access redirect or Worker auth denial");
}

function isAccessRedirect(result) {
  return result.status >= 300
    && result.status < 400
    && ACCESS_HOST_PATTERN.test(result.locationHost);
}

function locationHost(location) {
  if (!location) {
    return "";
  }
  try {
    return new URL(location, baseUrl).hostname;
  } catch {
    return "";
  }
}

function leaksProtectedContent(body) {
  return /AtlasRouter Admin|#!MANAGED-CONFIG|\[Proxy\]|"profiles"|"subscribeToken"|"nodes"/.test(body);
}

function summarizeBody(body) {
  return body.replace(/\s+/g, " ").trim().slice(0, 160) || "<empty>";
}

function pass() {
  return { ok: true, message: "" };
}

function fail(message) {
  return { ok: false, message };
}
