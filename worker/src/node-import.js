import { HttpError } from "./errors.js";
import { identifyNodeGroup } from "./node-pool.js";

const MAX_NODES = 1000;
const MAX_LINKS = 20;
const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

// Import only prepares a draft. Saving, classification and allocation still use
// the existing inventory endpoint and its revision check.
export async function importPoolNodes({ text, nodes }, fetcher = fetch, env = {}) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BYTES
    || !Array.isArray(nodes) || nodes.length > MAX_NODES) {
    throw invalid("请提供导入文本和待保存节点清单。");
  }
  const result = nodes.map((node) => {
    if (!node || typeof node.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(node.id)
      || (node.enabled !== undefined && typeof node.enabled !== "boolean")) {
      throw invalid("待保存节点清单格式不正确。");
    }
    parseLine(node.line);
    return { id: node.id, line: node.line, enabled: node.enabled ?? true };
  });
  const inputs = text.split(/\r?\n/).map((line, index) => ({ text: line.trim(), index: index + 1 }))
    .filter((entry) => entry.text && !/^[#;]/.test(entry.text));
  if (!inputs.length || inputs.length > MAX_NODES) throw invalid("每次请导入 1 至 1000 行节点。");

  const sources = inputs.map((entry) => {
    const named = !/^[a-z][a-z0-9+.-]*:\/\//i.test(entry.text)
      && entry.text.match(/^(.+?)\s*=\s*((?:https|vmess):\/\/.+)$/i);
    return { ...entry, name: named ? validName(named[1].trim()) : null, source: named ? named[2] : entry.text };
  });
  const urls = new Set(sources.filter((entry) => /^https:\/\//i.test(entry.source)).map((entry) => subscriptionUrl(entry.source)));
  if (urls.size > MAX_LINKS) throw invalid("每次最多导入 20 个不同的订阅链接，请分批导入。");
  const downloaded = new Map();
  const links = [...urls];
  const access = links.length ? readImportAccess(env) : null;
  // Bound concurrent connections, and fetch repeated URLs only once per import.
  for (let offset = 0; offset < links.length; offset += 4) {
    const batch = await Promise.all(links.slice(offset, offset + 4).map(async (url) => {
      try { return [url, { text: await downloadSubscription(url, fetcher, access) }]; }
      catch (error) { return [url, { error }]; }
    }));
    for (const [url, value] of batch) downloaded.set(url, value);
  }

  const keys = new Set(result.map((node) => connectionKey(parseLine(node.line))));
  const names = new Set(result.map((node) => parseLine(node.line).name));
  const warnings = [];
  let duplicates = 0;
  for (const entry of sources) {
    try {
      let content = entry.source;
      if (/^https:\/\//i.test(content)) {
        const response = downloaded.get(subscriptionUrl(content));
        if (response.error) throw response.error;
        content = response.text;
      }
      const imported = parseContent(content, entry.name);
      for (const item of imported) {
        const key = connectionKey(item);
        if (keys.has(key)) { duplicates += 1; continue; }
        if (result.length >= MAX_NODES) throw invalid("节点总数不能超过 1000。");
        const originalName = item.name;
        let suffix = 2;
        while (names.has(item.name)) item.name = `${originalName} (${suffix++})`;
        if (item.name !== originalName) warnings.push(`第 ${entry.index} 行：同名节点的连接配置不同，已为新节点名称追加序号。`);
        const line = `${item.name} = ${item.value}`;
        parseLine(line);
        result.push({ id: crypto.randomUUID(), line, enabled: true });
        keys.add(key);
        names.add(item.name);
        for (const warning of item.warnings ?? []) warnings.push(`第 ${entry.index} 行：${warning}`);
        try { identifyNodeGroup(item.name); }
        catch { warnings.push(`待保存清单第 ${result.length} 个节点：名称需包含一个地区旗帜和唯一一种 IDC / ISP / WARP 关键词，请补全后保存。`); }
      }
    } catch (error) {
      throw invalid(`第 ${entry.index} 行：${error instanceof HttpError ? error.message : "无法解析节点。"}`);
    }
  }
  if (new TextEncoder().encode(JSON.stringify({ nodes: result, revision: Number.MAX_SAFE_INTEGER })).length > MAX_BYTES) {
    throw invalid("转换后的清单超过 512 KiB，请减少节点后重试。");
  }
  return { nodes: result, added: result.length - nodes.length, duplicates, warnings: [...new Set(warnings)] };
}

// Reset from stored definitions without source identities or allocation history.
export function resetPoolNodes(source) {
  if (!Array.isArray(source) || source.length > MAX_NODES) throw invalid("节点总数不能超过 1000。");
  const nodes = source.map(({ line, enabled }) => {
    parseLine(line);
    return { id: crypto.randomUUID(), line, enabled };
  });
  if (new TextEncoder().encode(JSON.stringify({ nodes, revision: Number.MAX_SAFE_INTEGER })).length > MAX_BYTES) {
    throw invalid("重置后的清单超过 512 KiB，请减少节点后重试。");
  }
  return nodes;
}

function parseContent(content, name) {
  let text = content.trim();
  if (/^[A-Za-z0-9+/_=\s-]+$/.test(text)) text = decodeBase64(text);
  if (/^</.test(text)) throw invalid("订阅返回了网页，请使用返回节点内容的订阅地址。");
  let lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^[#;]/.test(line));
  if (lines.includes("[Proxy]")) {
    lines = lines.slice(lines.indexOf("[Proxy]") + 1);
    const end = lines.findIndex((line) => line.startsWith("["));
    if (end !== -1) lines = lines.slice(0, end);
  }
  if (!lines.length || lines.length > MAX_NODES) throw invalid("订阅需包含 1 至 1000 个节点。");
  return lines.map((line) => {
    if (/^vmess:\/\//i.test(line)) return convertVmess(line, name);
    return parseLine(name && line.indexOf("=") > 0 ? `${name} = ${line.slice(line.indexOf("=") + 1)}` : line);
  });
}

function convertVmess(link, name) {
  let node;
  try { node = JSON.parse(decodeBase64(decodeURIComponent(link.slice(8).split("#", 1)[0]))); }
  catch { throw invalid("VMess 链接不是有效的 Base64 JSON。"); }
  if (!node || typeof node !== "object" || Array.isArray(node)) throw invalid("VMess 节点格式不正确。");
  const known = new Set(["v", "ps", "add", "port", "id", "aid", "scy", "net", "type", "host", "path", "tls", "sni", "alpn", "fp", "insecure", "allowInsecure", "vcn", "pcs"]);
  if (Object.keys(node).some((key) => !known.has(key) && node[key] !== "" && node[key] != null)) {
    throw invalid("VMess 含有尚未支持的参数，无法保证转换结果一致。");
  }
  const net = node.net || "tcp";
  if (!["tcp", "ws"].includes(net) || (node.type && node.type !== "none")) {
    throw invalid("仅支持普通 TCP 或 WebSocket 的 VMess 节点。");
  }
  if (node.tls && !["tls", "none"].includes(node.tls)) throw invalid("不支持该 VMess TLS 模式。");
  if (!["string", "number"].includes(typeof (node.aid ?? 0)) || !/^0+$/.test(String(node.aid ?? 0))) {
    throw invalid("仅支持 aid 为 0 或省略的 VMess AEAD 节点。");
  }
  if (typeof node.id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(node.id)) {
    throw invalid("VMess UUID 不正确。");
  }
  const port = Number(node.port);
  if (!["string", "number"].includes(typeof node.port) || !/^\d+$/.test(String(node.port))
    || !Number.isInteger(port) || port < 1 || port > 65535) throw invalid("VMess 端口不正确。");
  const encryption = { auto: "aes-128-gcm", "aes-128-gcm": "aes-128-gcm", "chacha20-poly1305": "chacha20-ietf-poly1305" }[node.scy || "auto"];
  if (typeof encryption !== "string") throw invalid("不支持该 VMess 加密方式。");
  const server = validHost(node.add);
  const params = { username: node.id.toLowerCase(), "encrypt-method": encryption, "vmess-aead": "true" };
  const warnings = [];
  if (node.tls === "tls") {
    params.tls = "true";
    if (node.sni) params.sni = validHost(node.sni);
    if (node.alpn) {
      const alpn = Array.isArray(node.alpn) ? node.alpn : typeof node.alpn === "string" ? node.alpn.split(",") : [];
      if (!alpn.length || alpn.some((value) => typeof value !== "string" || !/^[a-z0-9./_-]+$/i.test(value))) throw invalid("ALPN 格式不正确。");
      params.alpn = alpn.join(",");
      warnings.push("保留了 ALPN 设置，需要 Surge iOS 5.20.0+ / Mac 6.7.0+。");
    }
    const insecure = node.insecure ?? node.allowInsecure ?? false;
    if (![false, true, 0, 1, "0", "1", "false", "true", ""].includes(insecure)) throw invalid("TLS 证书验证参数不正确。");
    if ([true, 1, "1", "true"].includes(insecure)) params["skip-cert-verify"] = "true";
    if (node.vcn) {
      params["server-cert-verify-name"] = validHost(node.vcn);
      warnings.push("保留了证书校验名称，需要 Surge iOS 5.21.0+ / Mac 6.8.0+。");
    }
    if (node.pcs) {
      if (typeof node.pcs !== "string" || !/^[a-f0-9]{64}$/i.test(node.pcs)) throw invalid("证书指纹需为 SHA-256 格式。");
      params["server-cert-fingerprint-sha256"] = node.pcs;
    }
    if (node.fp) warnings.push("TLS 浏览器指纹设置在 Surge 中没有对应参数，未写入该设置。");
  }
  if (net === "ws") {
    params.ws = "true";
    params["ws-path"] = node.path || "/";
    if (typeof params["ws-path"] !== "string" || !params["ws-path"].startsWith("/")) throw invalid("WebSocket 路径必须以 / 开头。");
    if (node.host) params["ws-headers"] = `Host:${validHost(node.host)}`;
  }
  const value = ["vmess", server.includes(":") && !server.startsWith("[") ? `[${server}]` : server, String(port),
    ...Object.entries(params).map(([key, value]) => `${key}=${quoteValue(value)}`)].join(", ");
  return { ...parseLine(`${validName(name || node.ps || "导入节点")} = ${value}`), warnings };
}

function quoteValue(value) {
  if (typeof value !== "string" || /[\x00-\x1f\x7f"\\]/.test(value)) throw invalid("节点参数包含无法安全转换的字符。");
  return /[,;#\s]/.test(value) ? `"${value}"` : value;
}

function validName(name) {
  if (typeof name !== "string" || !name.trim() || /[\x00-\x1f\x7f,=\[\]{}]/.test(name) || /^[#;]/.test(name.trim())) {
    throw invalid("节点名称为空或包含配置分隔符，请使用“节点名 = 链接”指定名称。");
  }
  return name.trim();
}

function validHost(host) {
  if (typeof host !== "string" || !host || !/^[a-z0-9_.:\[\]-]+$/i.test(host)) throw invalid("节点主机名格式不正确。");
  return host;
}

function parseLine(line) {
  if (typeof line !== "string" || line.length > 4096 || /[\r\n]/.test(line)) throw invalid("Surge 节点必须是最多 4096 字符的单行配置。");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) throw invalid("仅支持 HTTPS 订阅、vmess:// 链接和 Surge 节点行。");
  const separator = line.indexOf("=");
  if (separator < 1) throw invalid("需要完整的“节点名 = 配置”Surge 节点行。");
  const name = validName(line.slice(0, separator));
  const value = line.slice(separator + 1).trim();
  if (!value) throw invalid("Surge 节点配置不能为空。");
  return { name, value };
}

// Compare connection settings rather than names. Quoted commas remain inside
// their values; credentials and unknown options are never discarded.
function connectionKey({ value }) {
  const parts = [];
  let start = 0, quoted = false, escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quoted) { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) { parts.push(value.slice(start, index).trim()); start = index + 1; }
  }
  if (quoted || escaped) throw invalid("Surge 节点参数引号不完整。");
  parts.push(value.slice(start).trim());
  const protocol = parts.shift().toLowerCase();
  const positional = [];
  const options = new Map();
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator < 1) { positional.push(part); continue; }
    const key = part.slice(0, separator).trim().toLowerCase();
    if (options.has(key)) throw invalid("Surge 节点含重复参数。");
    let content = part.slice(separator + 1).trim();
    if (content.startsWith('"') && content.endsWith('"')) content = content.slice(1, -1);
    options.set(key, content);
  }
  if (positional.length >= 2) {
    positional[0] = positional[0].toLowerCase();
    if (/^\d+$/.test(positional[1])) positional[1] = String(Number(positional[1]));
  }
  if (protocol === "vmess") {
    for (const [key, value] of Object.entries({ tls: "false", ws: "false", "vmess-aead": "false", "encrypt-method": "aes-128-gcm", "skip-cert-verify": "false" })) {
      options.set(key, (options.get(key) ?? value).toLowerCase());
    }
    if (options.has("username")) options.set("username", options.get("username").toLowerCase());
    if (options.get("tls") === "true") options.set("sni", (options.get("sni") ?? positional[0] ?? "").toLowerCase());
    if (options.get("ws") === "true" && !options.has("ws-path")) options.set("ws-path", "/");
  }
  return JSON.stringify([protocol, positional, [...options].sort(([a], [b]) => a.localeCompare(b))]);
}

function decodeBase64(value) {
  const compact = value.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw invalid("Base64 格式不正确。");
  try {
    const binary = atob(compact.padEnd(Math.ceil(compact.length / 4) * 4, "="));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))).trim();
  } catch { throw invalid("Base64 内容无法解码为 UTF-8 文本。"); }
}

function subscriptionUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw invalid("订阅链接格式不正确。"); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password
    || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || /^[\d.]+$/.test(host)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|arpa)$/.test(host)) {
    throw invalid("订阅链接必须使用公网域名的 HTTPS 地址，且不能包含用户信息。");
  }
  url.hash = "";
  return url.toString();
}

function readImportAccess(env) {
  const { NODE_IMPORT_ACCESS_ORIGIN: origin, NODE_IMPORT_ACCESS_CLIENT_ID: clientId,
    NODE_IMPORT_ACCESS_CLIENT_SECRET: clientSecret } = env;
  try {
    const entries = [];
    if (![origin, clientId, clientSecret].every((value) => value === undefined || value === "")) {
      entries.push({ origin, clientId, clientSecret });
    }
    if (env.NODE_IMPORT_ACCESS_UPSTREAMS !== undefined && env.NODE_IMPORT_ACCESS_UPSTREAMS !== "") {
      const additional = JSON.parse(env.NODE_IMPORT_ACCESS_UPSTREAMS);
      if (!Array.isArray(additional)) throw new Error("Invalid Access configuration");
      entries.push(...additional);
    }
    const access = new Map();
    for (const entry of entries) {
      const configured = new URL(entry.origin);
      subscriptionUrl(entry.origin);
      if (configured.pathname !== "/" || configured.search || configured.hash || access.has(configured.origin)
        || ![entry.clientId, entry.clientSecret].every((value) => typeof value === "string" && /^[\x21-\x7e]+$/.test(value))) {
        throw new Error("Invalid Access configuration");
      }
      access.set(configured.origin, {
        "CF-Access-Client-Id": entry.clientId, "CF-Access-Client-Secret": entry.clientSecret,
      });
    }
    return access;
  } catch { throw new HttpError(503, "订阅服务认证未正确配置。"); }
}

async function downloadSubscription(url, fetcher, access) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      method: "GET", redirect: "manual", signal: controller.signal, cache: "no-store",
      // Never forward service credentials to another origin or through redirects.
      headers: { accept: "text/plain, */*", "user-agent": "AtlasRouter-Node-Import/1.0",
        ...access?.get(new URL(url).origin),
      },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw invalid(response.status >= 300 && response.status < 400
        ? "订阅发生重定向，请使用最终的 HTTPS 地址。" : "订阅请求失败，请检查链接是否有效。");
    }
    const reader = response.body?.getReader();
    if (!reader) throw invalid("订阅返回空内容。");
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw invalid("订阅响应不能超过 512 KiB。"); }
      chunks.push(value);
    }
    return await new Blob(chunks).text();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw invalid(controller.signal.aborted ? "订阅请求超时，请稍后重试。" : "无法获取订阅，请检查链接或网络。");
  } finally { clearTimeout(timer); }
}

function invalid(message) { return new HttpError(400, message); }
