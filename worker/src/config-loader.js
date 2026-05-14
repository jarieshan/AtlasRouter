import { HttpError } from "./errors.js";
import { parseNodesConfig } from "./nodes.js";

export const ROUTER_CONFIG_KV_KEY = "router-config";

export async function loadRouterConfig(env) {
  if (!env.ATLAS_ROUTER || typeof env.ATLAS_ROUTER.get !== "function") {
    throw new HttpError(500, "ATLAS_ROUTER KV binding is not configured");
  }

  let value;
  try {
    value = await env.ATLAS_ROUTER.get(ROUTER_CONFIG_KV_KEY, "json");
  } catch {
    throw new HttpError(500, "ATLAS_ROUTER key router-config must contain valid JSON");
  }

  if (value == null) {
    throw new HttpError(500, "ATLAS_ROUTER key router-config is not configured");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(500, "ATLAS_ROUTER key router-config must be a JSON object");
  }

  return parseRouterConfig(value);
}

export async function saveRouterConfig(env, config) {
  if (!env.ATLAS_ROUTER || typeof env.ATLAS_ROUTER.put !== "function") {
    throw new HttpError(500, "ATLAS_ROUTER KV binding is not writable");
  }

  const normalized = parseRouterConfig(config);
  await env.ATLAS_ROUTER.put(ROUTER_CONFIG_KV_KEY, JSON.stringify(serializeRouterConfig(normalized), null, 2));
  return normalized;
}

export function parseRouterConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(500, "router-config must be a JSON object");
  }

  if (value.profiles != null && !Array.isArray(value.profiles)) {
    throw new HttpError(500, "router-config profiles must be a JSON array");
  }
  const profiles = value.profiles
    ? value.profiles.map(parseProfile)
    : [parseLegacyProfile(value)];

  validateUniqueProfiles(profiles);

  return {
    profiles,
  };
}

export function serializeRouterConfig(config) {
  return {
    profiles: config.profiles.map(serializeProfile),
  };
}

function parseProfile(profile, index) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new HttpError(500, `Profile at index ${index} must be an object`);
  }

  return normalizeProfile({
    id: requiredString(profile.id, `Profile at index ${index} must include id`),
    name: requiredString(profile.name, `Profile ${profile.id ?? index} must include name`),
    subscribeToken: requiredString(profile.subscribeToken, `Profile ${profile.id ?? index} must include subscribeToken`),
    mitm: profile.mitm,
    nodes: profile.nodes,
  });
}

function parseLegacyProfile(value) {
  return normalizeProfile({
    id: "default",
    name: "Default",
    subscribeToken: requiredString(value.subscribeToken, "router-config must include subscribeToken"),
    mitm: value.mitm,
    nodes: value.nodes,
  });
}

function normalizeProfile(profile) {
  assertSingleLine(profile.id, `Profile ${profile.id} id must be a single line`);
  assertSingleLine(profile.name, `Profile ${profile.id} name must be a single line`);
  assertSingleLine(profile.subscribeToken, `Profile ${profile.id} subscribeToken must be a single line`);
  if (profile.id.includes(",")) {
    throw new HttpError(500, `Profile ${profile.id} id cannot contain a comma`);
  }

  return {
    id: profile.id,
    name: profile.name,
    subscribeToken: profile.subscribeToken,
    mitm: parseMitmConfig(profile.mitm, profile.id),
    nodes: parseNodesConfig(profile.nodes),
  };
}

function serializeProfile(profile) {
  const output = {
    id: profile.id,
    name: profile.name,
    subscribeToken: profile.subscribeToken,
    nodes: profile.nodes.map((node) => ({
      group: node.group,
      line: node.line,
    })),
  };

  if (profile.mitm) {
    output.mitm = {
      enabled: profile.mitm.enabled,
      hostname: profile.mitm.hostname,
      caP12: profile.mitm.caP12,
      caPassphrase: profile.mitm.caPassphrase,
      caCertificate: profile.mitm.caCertificate,
    };
  }

  return output;
}

function parseMitmConfig(value, profileId) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(500, `Profile ${profileId} mitm must be an object`);
  }

  const enabled = value.enabled === true;
  const hostname = optionalString(value.hostname, `Profile ${profileId} mitm hostname must be a string`);
  const caP12 = optionalString(value.caP12, `Profile ${profileId} mitm caP12 must be a string`);
  const caPassphrase = optionalString(value.caPassphrase, `Profile ${profileId} mitm caPassphrase must be a string`);
  const caCertificate = optionalString(value.caCertificate, `Profile ${profileId} mitm caCertificate must be a string`);

  assertSingleLine(hostname, `Profile ${profileId} mitm hostname must be a single line`);
  assertSingleLine(caP12, `Profile ${profileId} mitm caP12 must be a single line`);
  assertSingleLine(caPassphrase, `Profile ${profileId} mitm caPassphrase must be a single line`);
  if (caP12 && !/^[A-Za-z0-9+/=]+$/.test(caP12)) {
    throw new HttpError(500, `Profile ${profileId} mitm caP12 must be base64`);
  }
  if (enabled && (!caP12 || !caPassphrase)) {
    throw new HttpError(500, `Profile ${profileId} mitm requires caP12 and caPassphrase when enabled`);
  }
  if ((caP12 && !caPassphrase) || (!caP12 && caPassphrase)) {
    throw new HttpError(500, `Profile ${profileId} mitm caP12 and caPassphrase must be configured together`);
  }

  return {
    enabled,
    hostname,
    caP12,
    caPassphrase,
    caCertificate,
  };
}

function validateUniqueProfiles(profiles) {
  if (profiles.length === 0) {
    throw new HttpError(500, "router-config profiles must contain at least one profile");
  }

  const ids = new Set();
  const tokens = new Set();
  for (const profile of profiles) {
    if (ids.has(profile.id)) {
      throw new HttpError(500, `Duplicate profile id: ${profile.id}`);
    }
    if (tokens.has(profile.subscribeToken)) {
      throw new HttpError(500, `Duplicate subscribeToken in profile: ${profile.id}`);
    }
    ids.add(profile.id);
    tokens.add(profile.subscribeToken);
  }
}

function requiredString(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(500, message);
  }
  return value.trim();
}

function optionalString(value, message) {
  if (value == null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new HttpError(500, message);
  }
  return value.trim();
}

function assertSingleLine(value, message) {
  if (/[\r\n]/.test(value)) {
    throw new HttpError(500, message);
  }
}
