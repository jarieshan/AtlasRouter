import { positiveInteger, splitSurgeList, surgeAssignment, surgeBoolean, surgeOptions } from "./surge-format.js";

// Unknown connection options discard the whole node, never weaken its TLS or transport.
export function convertClashNode(line, warn = () => {}) {
  const [name, value] = surgeAssignment(line);
  const [protocol, host, port, ...params] = splitSurgeList(value);
  const type = { vmess: "vmess", trojan: "trojan", ss: "ss", http: "http", https: "http", socks5: "socks5", "socks5-tls": "socks5" }[protocol?.toLowerCase()];
  if (typeof type !== "string" || !host) throw new Error("Unsupported protocol");
  const node = { name, type, server: host.replace(/^\[|\]$/g, ""), port: positiveInteger(port) };
  if (node.port > 65535) throw new Error("Invalid port");
  const options = surgeOptions(params);
  const take = (key, fallback) => { const result = options.has(key) ? options.get(key) : fallback; options.delete(key); return result; };
  const required = (key) => { const result = take(key); if (!result) throw new Error("Missing parameter"); return result; };
  if (options.has("tfo")) node.tfo = surgeBoolean(take("tfo"));
  omitTestOverrides(options, warn);
  if (options.has("udp-relay")) node.udp = surgeBoolean(take("udp-relay"));
  else if (["vmess", "trojan"].includes(type)) node.udp = true;
  if (type === "vmess") {
    node.uuid = required("username");
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(node.uuid)
      || !surgeBoolean(take("vmess-aead", "false"))) throw new Error("Unsupported VMess authentication");
    node.alterId = 0;
    node.cipher = { "aes-128-gcm": "aes-128-gcm", "chacha20-ietf-poly1305": "chacha20-poly1305" }[take("encrypt-method", "aes-128-gcm")];
    if (typeof node.cipher !== "string") throw new Error("Unsupported cipher");
  } else if (type === "trojan" || type === "ss") {
    node.password = required("password");
    if (type === "ss") {
      node.cipher = required("encrypt-method");
      if (!["aes-128-gcm", "aes-192-gcm", "aes-256-gcm", "chacha20-ietf-poly1305", "aes-128-cfb", "aes-192-cfb", "aes-256-cfb", "chacha20-ietf", "xchacha20-ietf-poly1305"].includes(node.cipher)) throw new Error("Unsupported cipher");
      const obfs = take("obfs");
      if (obfs) {
        if (!["http", "tls"].includes(obfs)) throw new Error("Unsupported obfuscation");
        node.plugin = "obfs";
        node["plugin-opts"] = { mode: obfs };
        if (options.has("obfs-host")) node["plugin-opts"].host = take("obfs-host");
      }
    }
  } else {
    for (const key of ["username", "password"]) if (options.has(key)) node[key] = take(key);
  }

  const tlsProtocol = ["trojan", "https", "socks5-tls"].includes(protocol.toLowerCase());
  const tls = surgeBoolean(take("tls", String(tlsProtocol)));
  if ((tlsProtocol && !tls) || (type === "ss" && tls)) throw new Error("Unsupported TLS mode");
  if (tls) {
    if (type !== "trojan") node.tls = true;
    if (options.has("sni")) {
      const sni = take("sni");
      // Surge's sentinel disables SNI; a literal hostname in Mihomo would not.
      if (sni.toLowerCase() === "off") throw new Error("Unsupported SNI mode");
      node[type === "vmess" ? "servername" : "sni"] = sni;
    }
    if (options.has("skip-cert-verify")) node["skip-cert-verify"] = surgeBoolean(take("skip-cert-verify"));
    if (options.has("server-cert-verify-name")) node["name-cert-verify"] = take("server-cert-verify-name");
    if (options.has("server-cert-fingerprint-sha256")) {
      const fingerprint = take("server-cert-fingerprint-sha256").replaceAll(":", "");
      if (!/^[a-f0-9]{64}$/i.test(fingerprint)) throw new Error("Unsupported certificate fingerprint");
      node.fingerprint = fingerprint;
    }
    if (options.has("alpn")) node.alpn = splitSurgeList(take("alpn"));
  }
  const ws = surgeBoolean(take("ws", "false"));
  if (ws) {
    if (!["vmess", "trojan"].includes(type)) throw new Error("Unsupported transport");
    node.network = "ws";
    const path = take("ws-path", "/");
    if (!path.startsWith("/")) throw new Error("Invalid WebSocket path");
    node["ws-opts"] = { path };
    if (options.has("ws-headers")) {
      const headers = Object.create(null);
      for (const header of take("ws-headers").split("|")) {
        const colon = header.indexOf(":");
        if (colon < 1) throw new Error("Invalid WebSocket header");
        headers[header.slice(0, colon).trim()] = header.slice(colon + 1).trim();
      }
      node["ws-opts"].headers = headers;
    }
  }
  if (options.has("underlying-proxy")) node["dialer-proxy"] = take("underlying-proxy");
  if (options.size) throw new Error("Unsupported connection options");
  return node;
}

// Surge keeps tailnet settings in [Tailscale <section-name>]; Mihomo embeds them in the proxy.
export function convertClashTailscale(line, sections, warn = () => {}) {
  const [name, value] = surgeAssignment(line);
  const [protocol, ...params] = splitSurgeList(value);
  if (protocol?.toLowerCase() !== "tailscale") throw new Error("Unsupported protocol");
  const options = surgeOptions(params);
  omitTestOverrides(options, warn);
  const section = `tailscale ${options.get("section-name")?.toLowerCase()}`;
  options.delete("section-name");
  // Surge sends only DERP through underlying-proxy and control traffic through rules; Mihomo's dialer-proxy would carry both.
  if (!sections.has(section) || options.size) throw new Error("Unsupported Tailscale policy");
  const settings = surgeOptions(sections.get(section));
  const take = (key, fallback) => { const result = settings.has(key) ? settings.get(key) : fallback; settings.delete(key); return result; };
  const node = { name, type: "tailscale", udp: true };
  const authKey = take("auth-key");
  if (surgeBoolean(take("interactive-login", "false")) === Boolean(authKey)) throw new Error("Tailscale requires one login method");
  if (authKey) node["auth-key"] = authKey;
  const hostname = take("hostname");
  if (hostname) node.hostname = hostname;
  if (take("exit-node", "none").toLowerCase() !== "none") throw new Error("Unsupported exit node");
  const autoRoute = surgeBoolean(take("auto-add-magic-dns-rule", "true"));
  if (settings.size) throw new Error("Unsupported Tailscale settings");
  return { node, section, autoRoute, interactive: !authKey };
}

function omitTestOverrides(options, warn) {
  // Mihomo tests at group level; do not silently discard per-policy overrides.
  for (const key of ["test-url", "test-timeout"]) {
    if (options.has(key)) warn(`${key}: per-node test override omitted; group test settings used`);
    options.delete(key);
  }
}
