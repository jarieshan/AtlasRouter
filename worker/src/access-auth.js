import { HttpError } from "./errors.js";
import { isPreviewIdentity } from "./page-preview.js";

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const JWKS_CACHE = new Map();

export async function requireAccessAdmin(request, env) {
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);
  const payload = await requireAccessIdentity(request, env, env.ACCESS_AUD);
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email || !adminEmails.has(email) || await isPreviewIdentity(email, env)) {
    throw new HttpError(403, "Forbidden");
  }

  return payload;
}

export async function requireAccessUser(request, env) {
  const payload = await requireAccessIdentity(request, env, env.ACCESS_AUD);
  if (typeof payload.email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(payload.email.trim())) {
    throw new HttpError(403, "Cloudflare Access user identity is required");
  }
  return { email: payload.email.trim().toLowerCase() };
}

export function isAdminEmail(email, env) {
  if (typeof env.ADMIN_EMAILS !== "string" || !env.ADMIN_EMAILS.trim()) return false;
  return parseAdminEmails(env.ADMIN_EMAILS).has(email);
}

async function requireAccessIdentity(request, env, aud) {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = requiredString(aud, "Cloudflare Access audience is not configured");
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) {
    throw new HttpError(403, "Missing Cloudflare Access token");
  }

  return verifyAccessJwt(token, { teamDomain, audience, env });
}

export async function verifyAccessJwt(token, { teamDomain, audience, env }) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new HttpError(403, "Invalid Cloudflare Access token");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseBase64UrlJson(encodedHeader);
  const payload = parseBase64UrlJson(encodedPayload);
  if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new HttpError(403, "Invalid Cloudflare Access token");
  }
  if (payload.iss !== teamDomain || !audienceMatches(payload.aud, audience)) {
    throw new HttpError(403, "Invalid Cloudflare Access token");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new HttpError(403, "Expired Cloudflare Access token");
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    throw new HttpError(403, "Cloudflare Access token is not active");
  }

  const jwk = await findAccessJwk(header.kid, teamDomain, env);
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) {
    throw new HttpError(403, "Invalid Cloudflare Access token");
  }

  return payload;
}

function normalizeTeamDomain(value) {
  const teamDomain = requiredString(value, "ACCESS_TEAM_DOMAIN is not configured").replace(/\/+$/, "");
  if (!teamDomain.startsWith("https://")) {
    throw new HttpError(500, "ACCESS_TEAM_DOMAIN must start with https://");
  }
  return teamDomain;
}

function parseAdminEmails(value) {
  const emails = requiredString(value, "ADMIN_EMAILS is not configured")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    throw new HttpError(500, "ADMIN_EMAILS must include at least one email");
  }
  return new Set(emails);
}

function requiredString(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(500, message);
  }
  return value.trim();
}

async function findAccessJwk(kid, teamDomain, env) {
  const jwks = await loadAccessJwks(teamDomain, env);
  const jwk = jwks.keys?.find((key) => key.kid === kid);
  if (!jwk) {
    throw new HttpError(403, "Unknown Cloudflare Access signing key");
  }
  return jwk;
}

async function loadAccessJwks(teamDomain, env) {
  if (env.ACCESS_JWKS_JSON) {
    return JSON.parse(env.ACCESS_JWKS_JSON);
  }

  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  const cached = JWKS_CACHE.get(certsUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetch(certsUrl);
  if (!response.ok) {
    throw new HttpError(403, "Unable to load Cloudflare Access signing keys");
  }
  const value = await response.json();
  JWKS_CACHE.set(certsUrl, {
    value,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  return value;
}

function audienceMatches(actual, expected) {
  if (typeof actual === "string") {
    return actual === expected;
  }
  if (Array.isArray(actual)) {
    return actual.includes(expected);
  }
  return false;
}

function parseBase64UrlJson(value) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
  } catch {
    throw new HttpError(403, "Invalid Cloudflare Access token");
  }
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(403, "Invalid Cloudflare Access token");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new HttpError(403, "Invalid Cloudflare Access token");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
