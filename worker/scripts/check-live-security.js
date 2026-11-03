#!/usr/bin/env node

import {
  ACCOUNT_PATH, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH, POOL_SUBSCRIPTION_PATH, getAdminRoutes,
} from "../src/routes.js";

const DEFAULT_TIMEOUT_MS = 12_000;
const ACCESS_HOST_PATTERN = /(^|\.)cloudflareaccess\.com$/i;
const ADMIN_DENY_MESSAGES = new Set([
  "Missing Cloudflare Access token", "Invalid Cloudflare Access token", "Expired Cloudflare Access token",
  "Cloudflare Access token is not active", "Unknown Cloudflare Access signing key", "Forbidden",
]);
const { baseUrl, timeoutMs } = parseArgs(process.argv.slice(2));
const adminRoutes = getAdminRoutes(process.env);
if (process.env.ADMIN_API_SLUG !== undefined && !adminRoutes) throw new Error("Invalid ADMIN_API_SLUG");
if (!adminRoutes) console.log("SKIP management API probes: ADMIN_API_SLUG is not set.");

const checks = [
  protectedAdmin("root portal", "GET", ACCOUNT_PATH),
  protectedAdmin("account profile", "GET", ACCOUNT_PROFILE_PATH),
  protectedAdmin("account token reset", "POST", ACCOUNT_TOKEN_PATH, { "content-type": "application/json" }, "{}"),
  protectedAdmin("forged role ignored", "GET", `${ACCOUNT_PATH}?role=admin&email=admin@example.com`),
  protectedAdmin("forged identity ignored", "GET", ACCOUNT_PATH, { "cf-access-authenticated-user-email": "admin@example.com" }),
  unauthorizedRoute("subscription without token", POOL_SUBSCRIPTION_PATH),
  unauthorizedRoute("subscription invalid token", `${POOL_SUBSCRIPTION_PATH}?token=invalid-token`),
  unauthorizedRoute("Clash subscription without token", `${POOL_SUBSCRIPTION_PATH}?client=clash`),
  unauthorizedRoute("DoH subscription invalid token", `${POOL_SUBSCRIPTION_PATH}?token=invalid-token&client=clash&doh=1`),
  unauthorizedRoute("subscription admin token ignored", `${POOL_SUBSCRIPTION_PATH}?admin_token=invalid-token`),
  unauthorizedRoute("subscription forged credentials ignored", POOL_SUBSCRIPTION_PATH, {
    authorization: "Bearer test-only", "cf-access-jwt-assertion": "bogus",
  }),
  unauthorizedRoute("module without token", `${POOL_SUBSCRIPTION_PATH}/modules/tencent-oa.sgmodule`),
  ...[
    ["GET", "/admin"], ["GET", "/admin/config"], ["POST", "/admin/certificates"],
    ["GET", "/atlas"], ["GET", "/atlas/config"], ["GET", "/atlasrouter"], ["GET", "/atlas-router"],
    ["GET", "/atlasrouter/modules/skip-proxy-lists.sgmodule"],
    ["GET", "/AtlasRouter/rules/missing"],
    ["GET", "/AtlasRouter/subscription"], ["GET", "/AtlasRouter/account"], ["GET", "/AtlasRouter/admin"],
    ["GET", "/AtlasRouter/admin/pool"], ["GET", "/AtlasRouter/account/profile"], ["POST", "/AtlasRouter/account/token"],
    ["GET", "/AtlasRouter/admin/config"], ["POST", "/AtlasRouter/admin/certificates"],
    ["GET", "/AtlasRouter/admin/pool/state"], ["PUT", "/AtlasRouter/admin/pool/nodes"], ["PATCH", "/AtlasRouter/admin/pool/users"],
    ["GET", "/api/admin/pool/state"], ["PUT", "/api/admin/pool/nodes"], ["PATCH", "/api/admin/pool/users"],
    ["GET", "/api/admin/config"], ["POST", "/api/admin/certificates"],
    ["GET", "/modules/skip-proxy-lists.sgmodule"], ["GET", "/AtlasRouter/subscription/modules/skip-proxy-lists.sgmodule"],
  ].map(([method, path]) => retiredRoute("retired route", method, path)),
];
if (adminRoutes) {
  checks.push(
    protectedAdmin("node pool state", "GET", adminRoutes.state),
    protectedAdmin("node pool write", "PUT", adminRoutes.nodes, { "content-type": "application/json" }, "{}"),
    protectedAdmin("node pool import", "POST", adminRoutes.import, { "content-type": "application/json" }, "{}"),
    protectedAdmin("node pool user write", "PATCH", adminRoutes.users, { "content-type": "application/json" }, "{}"),
    protectedAdmin("admin query token ignored", "GET", `${adminRoutes.state}?admin_token=test-only`),
    protectedAdmin("admin authorization ignored", "GET", adminRoutes.state, { authorization: "Bearer test-only" }),
    protectedAdmin("admin fake Access JWT rejected", "GET", adminRoutes.state, { "cf-access-jwt-assertion": "bogus" }),
    protectedAdmin("admin CORS preflight", "OPTIONS", adminRoutes.nodes, { origin: "https://example.test", "access-control-request-method": "PUT" }),
    retiredRoute("admin trailing slash", "GET", `${adminRoutes.state}/`),
  );
}

let failures = 0;
console.log(`Live security target: ${baseUrl}`);

for (const check of checks) {
  const result = await request(check, timeoutMs);
  const verdict = check.assert(result);
  const line = [
    verdict.ok ? "PASS" : "FAIL",
    check.name,
    `${check.method} ${check.path.replace(/\/api\/[a-f0-9]{32}(?=\/)/g, "/api/<redacted>")}`,
    `status=${result.status}`,
    result.locationHost ? `location=${result.locationHost}` : "",
  ].filter(Boolean).join(" | ");

  console.log(line);
  if (!verdict.ok) {
    failures += 1;
    console.log(`  ${verdict.message}`);
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
not wired into npm test and must be run explicitly. Set ADMIN_API_SLUG in the
environment to include management API probes; its value is redacted in output.`);
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

function retiredRoute(name, method, path) {
  return {
    name, method, path,
    assert(result) {
      if (leaksProtectedContent(result.body)) return fail("response contains protected content");
      if (isAccessRedirect(result)) return pass();
      if (result.status === 404 && result.body.trim() === "Not Found") return pass();
      return fail("expected Not Found after reaching the Worker, or an Access redirect");
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
      headers: { "user-agent": "Mozilla/5.0 (compatible; AtlasRouterSecurityCheck/1.0)", ...check.headers },
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
  return /id="(?:account|pool)-panel"|#!MANAGED-CONFIG|\[Proxy\]|"profiles"|"subscribeToken"|"nodes"|"caP12"|"caPassphrase"/.test(body);
}

function pass() {
  return { ok: true, message: "" };
}

function fail(message) {
  return { ok: false, message };
}
