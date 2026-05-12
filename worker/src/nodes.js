import { HttpError } from "./errors.js";

const DIRECT_PROXY_TYPES = new Set(["http", "https", "socks5", "socks5-tls"]);
const PASSWORD_PROXY_TYPES = new Set(["trojan", "hysteria2", "anytls"]);

export function parseNodesJson(value) {
  if (!value) {
    throw new HttpError(500, "NODES_JSON is not configured");
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new HttpError(500, "NODES_JSON must be valid JSON");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new HttpError(500, "NODES_JSON must be a non-empty array");
  }

  return parsed.map(normalizeNode);
}

export function renderProxyLines(nodes) {
  return nodes.map(renderProxyLine).join("\n");
}

export function renderProxyLine(node) {
  validatePolicyName(node.name);

  if (node.surgeProxy) {
    assertSingleLine(node.surgeProxy, "surgeProxy");
    return `${node.name} = ${node.surgeProxy}`;
  }

  const type = requireString(node.type, "type");
  const server = requireString(node.server, "server");
  const port = requirePort(node.port);
  const parts = [type, server, String(port)];

  if (DIRECT_PROXY_TYPES.has(type)) {
    if (node.username || node.password) {
      parts.push(requireString(node.username, "username"));
      parts.push(requireString(node.password, "password"));
    }
  } else if (type === "ss") {
    parts.push(`encrypt-method=${requireString(node.encryptMethod, "encryptMethod")}`);
    parts.push(`password=${requireString(node.password, "password")}`);
  } else if (type === "vmess") {
    parts.push(`username=${requireString(node.username ?? node.uuid, "username")}`);
  } else if (type === "snell") {
    parts.push(`psk=${requireString(node.psk ?? node.password, "psk")}`);
    if (node.version) {
      parts.push(`version=${formatValue(node.version, "version")}`);
    }
  } else if (type === "tuic") {
    parts.push(`token=${requireString(node.token ?? node.password, "token")}`);
  } else if (PASSWORD_PROXY_TYPES.has(type)) {
    parts.push(`password=${requireString(node.password, "password")}`);
  } else {
    throw new HttpError(500, `Unsupported node type for ${node.name}`);
  }

  appendCommonParams(parts, node);
  appendCustomParams(parts, node.params);

  return `${node.name} = ${parts.join(", ")}`;
}

function normalizeNode(node, index) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new HttpError(500, `NODES_JSON item ${index + 1} must be an object`);
  }

  const name = requireString(node.name, "name");
  validatePolicyName(name);
  return { ...node, name };
}

function appendCommonParams(parts, node) {
  appendParam(parts, "sni", node.sni);
  appendParam(parts, "skip-cert-verify", node.skipCertVerify);
  appendParam(parts, "udp-relay", node.udpRelay);
  appendParam(parts, "tfo", node.tfo);
}

function appendCustomParams(parts, params) {
  if (params === undefined) {
    return;
  }
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new HttpError(500, "params must be an object");
  }

  for (const [key, value] of Object.entries(params)) {
    validateParamKey(key);
    appendParam(parts, key, value);
  }
}

function appendParam(parts, key, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  parts.push(`${key}=${formatValue(value, key)}`);
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(500, `Node ${field} is required`);
  }
  return formatValue(value, field);
}

function requirePort(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new HttpError(500, "Node port must be an integer between 1 and 65535");
  }
  return value;
}

function formatValue(value, field) {
  const text = String(value);
  assertSingleLine(text, field);
  if (text.includes(",")) {
    throw new HttpError(500, `${field} cannot contain a comma; use surgeProxy for raw Surge syntax`);
  }
  return text;
}

function assertSingleLine(value, field) {
  if (/[\r\n]/.test(value)) {
    throw new HttpError(500, `${field} must be a single line`);
  }
}

function validatePolicyName(name) {
  assertSingleLine(name, "name");
  if (/[=,]/.test(name)) {
    throw new HttpError(500, "Node name cannot contain '=' or ','");
  }
}

function validateParamKey(key) {
  if (!/^[a-zA-Z0-9-]+$/.test(key)) {
    throw new HttpError(500, `Invalid param key: ${key}`);
  }
}
