import { HttpError } from "./errors.js";

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
const JWKS_CACHE = new Map();

export async function requireAccessAdmin(request, env) {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = requiredString(env.ACCESS_AUD, "ACCESS_AUD is not configured");
  const adminEmails = parseAdminEmails(env.ADMIN_EMAILS);
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) {
    throw new HttpError(403, "Missing Cloudflare Access token");
  }

  const payload = await verifyAccessJwt(token, { teamDomain, audience, env });
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email || !adminEmails.has(email)) {
    throw new HttpError(403, "Forbidden");
  }

  return payload;
}

export async function verifyAccessJwt(token, { teamDomain, audience, env }) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new HttpError(403, "Invalid Cloudflare Access token");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseBase64UrlJson(encodedHeader);
  const payload = parseBase64UrlJson(encodedPayload);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
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
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
