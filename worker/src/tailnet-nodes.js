import { HttpError } from "./errors.js";
import { positiveInteger, splitSurgeList, surgeAssignment, surgeBoolean, surgeOptions } from "./surge-format.js";

const PREFIX = "Tailnet Test - ";
const SUPPORTED_OPTIONS = new Set([
  "username", "encrypt-method", "vmess-aead", "tls", "sni", "alpn", "skip-cert-verify",
  "udp-relay", "tfo", "test-url", "test-timeout", "block-quic", "hybrid", "ip-version",
]);

// Apply the transport after allocation so switching it never reallocates users.
export function createTailnetNodes(nodes, rawEndpoints, { replace = false } = {}) {
  if (!rawEndpoints && !replace) return [];
  const endpoints = readTailnetEndpoints(rawEndpoints);
  const names = new Set(replace ? [] : nodes.map((node) => node.name));
  const result = [];
  for (const node of nodes) {
    let parts;
    try { parts = splitSurgeList(node.value); }
    catch {
      if (replace) throw new HttpError(503, "Invalid Tailnet subscription node");
      continue;
    }
    const endpoint = endpoints.find(({ server, port }) =>
      server === parts[1]?.toLowerCase() && String(port) === parts[2]);
    if (!endpoint) {
      if (replace) throw new HttpError(503, "Tailnet endpoint is not configured for every subscription node");
      continue;
    }
    try {
      const options = surgeOptions(parts.slice(3));
      if (parts[0].toLowerCase() !== "vmess" || !options.get("username")
        || !surgeBoolean(options.get("tls") ?? "false")
        || !surgeBoolean(options.get("vmess-aead") ?? "false")
        || [...options.keys()].some((key) => !SUPPORTED_OPTIONS.has(key))) throw new Error();
      const name = replace ? node.name : PREFIX + node.name;
      if (names.has(name)) throw new Error();
      names.add(name);
      // Preserve quoted values (including credentials and ALPN lists) verbatim.
      const params = parts.slice(3).filter((part) =>
        !["sni", "skip-cert-verify"].includes(surgeAssignment(part)[0].toLowerCase()));
      const value = [parts[0], endpoint.hostname, parts[2], ...params,
        `sni=${endpoint.hostname}`, "skip-cert-verify=false", "underlying-proxy=Tailnet"].join(", ");
      result.push({ ...node, name, value, line: `${name} = ${value}` });
    } catch {
      // Never include the source line or secret mapping in an HTTP error.
      throw new HttpError(503, "Tailnet endpoint requires compatible VMess TCP TLS nodes with unique names");
    }
  }
  return result;
}

export function readTailnetEndpoints(raw) {
  try {
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length > 100) throw new Error();
    const seen = new Set();
    return entries.map((entry) => {
      if (!entry || Object.keys(entry).some((key) => !["server", "port", "hostname"].includes(key))
        || !hostname(entry.server) || !hostname(entry.hostname)
        || !entry.hostname.toLowerCase().endsWith(".ts.net")
        || !Number.isInteger(entry.port) || positiveInteger(String(entry.port)) > 65535) throw new Error();
      const server = entry.server.toLowerCase();
      const key = `${server}:${entry.port}`;
      if (seen.has(key)) throw new Error();
      seen.add(key);
      return { server, port: entry.port, hostname: entry.hostname.toLowerCase() };
    });
  } catch {
    throw new HttpError(503, "Invalid Tailnet endpoint configuration");
  }
}

function hostname(value) {
  return typeof value === "string" && value.length <= 253 && value.includes(".")
    && value.split(".").every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}
