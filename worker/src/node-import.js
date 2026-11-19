import { HttpError } from "./errors.js";
import { groupNodeVariants, identifyNodeGroup } from "./node-pool.js";
import { spaceBeforeIpType } from "./nodes.js";

const MAX_NODES = 1000;
const MAX_LINKS = 20;
const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
// 3x-ui joins an inbound remark such as "🇭🇰 HK-Hy2" and a client such as
// "ISP-AU-1". Two capitals after the type name the exit the inbound relays to.
const RELAY_NAME = /^(?:[\u{1F1E6}-\u{1F1FF}]{2}\s*)?([^\s-]+)((?:-[^\s-]+)*?)[- ](ISP|IDC|WARP)-([A-Z]{2})(-.*)?$/u;
// Full names follow full-name inbounds such as HongKong. Administrators enter
// any other exit during the import that needs it.
const RELAY_EXITS = {
  AE: "UnitedArabEmirates", AR: "Argentina", AU: "Australia", BR: "Brazil", CA: "Canada", CH: "Switzerland",
  DE: "Germany", ES: "Spain", FR: "France", GB: "UnitedKingdom", HK: "HongKong", ID: "Indonesia", IN: "India",
  IT: "Italy", JP: "Japan", KR: "Korea", MO: "Macau", MY: "Malaysia", NL: "Netherlands", PH: "Philippines",
  RU: "Russia", SE: "Sweden", SG: "Singapore", TH: "Thailand", TR: "Turkey", TW: "Taiwan", UK: "UnitedKingdom",
  US: "UnitedStates", VN: "Vietnam",
};

// Import only prepares a draft. Saving, classification and allocation still use
// the existing inventory endpoint and its revision check.
export async function importPoolNodes({ text, nodes, exits }, fetcher = fetch, env = {}) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BYTES
    || !Array.isArray(nodes) || nodes.length > MAX_NODES) {
    throw invalid("请提供导入文本和待保存节点清单。");
  }
  const manualExits = readManualExits(exits);
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
    // A 3x-ui export labels the subscription, which can contain several named nodes.
    const urlColumn = entry.text.match(/[ \t](https:\/\/\S+)$/i);
    if (urlColumn && !/=|:\/\//.test(entry.text.slice(0, urlColumn.index))) {
      return { ...entry, name: null, source: urlColumn[1] };
    }
    const named = !/^[a-z][a-z0-9+.-]*:\/\//i.test(entry.text)
      && entry.text.match(/^(.+?)\s*=\s*((?:https|vmess|vless|hy2|hysteria2):\/\/.+)$/i);
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

  const keys = new Map();
  for (const node of result) {
    const key = connectionKey(parseLine(node.line));
    keys.set(key, keys.has(key) ? null : node);
  }
  const names = new Map(result.map((node) => [parseLine(node.line).name, node]));
  const warningLines = new Map();
  const unclassifiedNodes = [];
  const unknownExits = new Map();
  function warn(line, message) {
    if (!warningLines.has(message)) warningLines.set(message, new Set());
    warningLines.get(message).add(line);
  }
  function askExit(item) {
    if (!unknownExits.has(item.unknownExit)) unknownExits.set(item.unknownExit, { code: item.unknownExit, name: item.sourceName });
  }
  let duplicates = 0;
  for (const entry of sources) {
    try {
      let content = entry.source;
      if (/^https:\/\//i.test(content)) {
        const response = downloaded.get(subscriptionUrl(content));
        if (response.error) throw response.error;
        content = response.text;
      }
      const imported = parseContent(content, entry.name).map((item) => convertName(item, manualExits));
      if (/^https:\/\//i.test(entry.source) && keys.size && imported.length >= 3) {
        for (const message of alignSubscriptionVariants(imported, keys, names)) warn(entry.index, message);
      }
      for (const item of imported) {
        const key = connectionKey(item);
        if (keys.has(key)) {
          const [sourceName, legacyName] = sourceNames(item);
          for (const oldName of [sourceName, legacyName]) {
            const previous = oldName && oldName !== item.name && names.get(oldName);
            if (!previous || connectionKey(parseLine(previous.line)) !== key) continue;
            if (item.unknownExit) askExit(item);
            else if (renameDraftNode(previous, item.name, names)) {
              warn(entry.index, oldName === legacyName ? "已将已有 VMess 节点的协议标记加入待保存名称，保留原 ID 和启停状态。"
                : "已有节点仍使用上游原名，已在待保存清单中改为转换后的名称，保留原 ID 和启停状态。");
            }
            break;
          }
          duplicates += 1; continue;
        }
        if (result.length >= MAX_NODES) throw invalid("节点总数不能超过 1000。");
        if (item.unknownExit) {
          askExit(item);
          warn(entry.index, `无法识别中转出口 ${item.unknownExit}，新节点已去掉入口旗帜，请在待保存清单中补全出口国家后保存。`);
        }
        if (item.relay) warn(entry.index, "已识别中转节点，改用出口国家的旗帜和名称。");
        const originalName = item.name;
        let suffix = 2;
        while (names.has(item.name)) item.name = `${originalName} (${suffix++})`;
        if (item.name !== originalName) warn(entry.index, "同名节点的连接配置不同，已为新节点名称追加序号。");
        const line = `${item.name} = ${item.value}`;
        parseLine(line);
        const node = { id: crypto.randomUUID(), line, enabled: true };
        result.push(node);
        keys.set(key, node);
        names.set(item.name, node);
        for (const warning of item.warnings ?? []) warn(entry.index, warning);
        try { identifyNodeGroup(item.name); }
        catch { unclassifiedNodes.push(result.length); }
      }
    } catch (error) {
      throw invalid(`第 ${entry.index} 行：${error instanceof HttpError ? error.message : "无法解析节点。"}`);
    }
  }
  if (new TextEncoder().encode(JSON.stringify({ nodes: result, revision: Number.MAX_SAFE_INTEGER })).length > MAX_BYTES) {
    throw invalid("转换后的清单超过 512 KiB，请减少节点后重试。");
  }
  const warnings = Array.from(warningLines, ([message, lines]) => `第 ${formatPositions(lines)} 行：${message}`);
  if (unclassifiedNodes.length) {
    warnings.push(`待保存清单第 ${formatPositions(unclassifiedNodes)} 个节点：名称需包含一个地区旗帜和唯一一种 IDC / ISP / WARP 关键词，请补全后保存。`);
  }
  return { nodes: result, added: result.length - nodes.length, duplicates, warnings, unknownExits: [...unknownExits.values()] };
}

// Stored names keep the subscription's flag and region unless the client name
// identifies a relay exit. An unknown exit drops the inbound flag, so saving
// needs a completed name instead of joining the inbound's group.
function convertName(item, manualExits) {
  const converted = { ...item, sourceName: item.name, name: spaceBeforeIpType(item.name) };
  const relay = item.name.match(RELAY_NAME);
  if (!relay) return converted;
  const [, inbound, tags, type, code, rest = ""] = relay;
  const exit = manualExits.get(code)
    ?? (RELAY_EXITS[code] && { flag: flagOf(code === "UK" ? "GB" : code), code, name: RELAY_EXITS[code] });
  if (!exit) return { ...converted, name: `${inbound}${tags} ${type}-${code}${rest}`, unknownExit: code };
  const region = /^[A-Z]{2,3}(?:\(.+\))?$/.test(inbound) ? exit.code : exit.name;
  return { ...converted, name: `${exit.flag} ${region}${tags} ${type}${rest}`, relay: true };
}

// An unedited saved node still carries an upstream name; older VMess remarks
// had no "-VMess" tag.
function sourceNames(item) {
  const tagged = /^vmess\s*,/i.test(item.value) && item.sourceName.match(/^(.+)-VMess([- ](?:ISP|IDC|WARP)\b.*)$/i);
  return tagged ? [item.sourceName, tagged[1] + tagged[2]] : [item.sourceName];
}

function readManualExits(exits) {
  if (exits === undefined) return new Map();
  if (!exits || typeof exits !== "object" || Array.isArray(exits) || Object.keys(exits).length > 50) {
    throw invalid("手动填写的中转出口格式不正确。");
  }
  return new Map(Object.entries(exits).map(([code, exit]) => {
    if (!/^[A-Z]{2}$/.test(code)) throw invalid("手动填写的中转出口格式不正确。");
    if (!exit || typeof exit.flag !== "string" || !/^[A-Za-z]{2}$/.test(exit.flag)
      || ![exit.code, exit.name].every((value) => typeof value === "string" && /^[\p{L}\p{N}().]{1,32}$/u.test(value))) {
      throw invalid(`中转出口 ${code} 需要两位字母的旗帜代码，以及不含空格、横杠和分隔符的简称与全称。`);
    }
    return [code, { flag: flagOf(exit.flag.toUpperCase()), code: exit.code, name: exit.name }];
  }));
}

function flagOf(code) {
  return String.fromCodePoint(...Array.from(code, (letter) => 0x1F1E6 + letter.charCodeAt(0) - 65));
}

// Both input lines and draft nodes are collected in ascending order.
function formatPositions(positions) {
  const ranges = [];
  for (const position of positions) {
    const last = ranges.at(-1);
    if (last && last[1] + 1 === position) last[1] = position;
    else ranges.push([position, position]);
  }
  return ranges.map(([first, last]) => first === last ? String(first) : `${first}–${last}`).join("、");
}

function renameDraftNode(node, name, names) {
  if (names.has(name)) return false;
  names.delete(parseLine(node.line).name);
  node.line = `${name} ${node.line.slice(node.line.indexOf("="))}`;
  names.set(name, node);
  return true;
}

// An upstream flag can identify the inbound's location while the saved flag
// identifies the client's exit. Only an exact, unique VMess connection and
// its independently matched subscription variants can carry that exit forward.
function alignSubscriptionVariants(items, keys, names) {
  const candidates = [];
  for (const [index, item] of items.entries()) {
    if (!/^(?:vmess|vless|hysteria2)\s*,/i.test(item.value)) continue;
    try {
      candidates.push({ ...item, ...identifyNodeGroup(item.name), id: String(index), enabled: true,
        ownerIds: [], assignmentCount: 0, item });
    } catch { /* Unclassified names remain editable in the draft. */ }
  }
  const warnings = [];
  for (const { variants } of groupNodeVariants(candidates)) {
    if (variants.length !== 3) continue;
    const [vless, vmess] = variants;
    if (!/-VMess[- ]/i.test(vmess.name)) continue;
    const existing = keys.get(connectionKey(vmess));
    if (!existing) continue;
    const oldName = parseLine(existing.line).name;
    let saved;
    try { saved = identifyNodeGroup(oldName); } catch { continue; }
    if (saved.ipType !== vmess.ipType) continue;
    // A saved source name records no chosen exit and follows the conversion.
    const unedited = variants.some(({ item }) => sourceNames(item).includes(oldName));
    if (!unedited && saved.region !== vmess.region) {
      const flag = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
      const oldFlag = oldName.match(flag)[0];
      for (const { item } of variants) {
        const before = item.name;
        item.name = before.replace(flag, oldFlag);
        const duplicate = keys.get(connectionKey(item));
        if (duplicate && parseLine(duplicate.line).name === before) renameDraftNode(duplicate, item.name, names);
      }
      warnings.push("同一客户端的协议连接沿用已有 VMess 节点的出口地区。");
    }
    // Older inventories used today's VLESS name for VMess. Free that name
    // before appending any new line, even when VLESS arrives first.
    if ([vless.item.sourceName, vless.item.name].includes(oldName) && renameDraftNode(existing, vmess.item.name, names)) {
      warnings.push("已同步 VMess 协议标记，保留原节点 ID 和启停状态。");
    }
  }
  return warnings;
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
    if (/^vless:\/\//i.test(line)) return convertVless(line, name);
    if (/^(?:hy2|hysteria2):\/\//i.test(line)) return convertHysteria2(line, name);
    return parseLine(name && line.indexOf("=") > 0 ? `${name} = ${line.slice(line.indexOf("=") + 1)}` : line);
  });
}

function convertHysteria2(link, name) {
  let url;
  try { url = new URL(link); }
  catch { throw invalid("Hy2 链接需要有效的主机名和单个端口。"); }
  const port = Number(url.port || 443);
  if (!url.username || !["", "/"].includes(url.pathname) || port < 1 || port > 65535) throw invalid("Hy2 凭据、路径或端口不正确。");
  const query = url.searchParams;
  const known = new Set(["security", "sni", "alpn", "insecure", "vcn", "pinSHA256", "fp", "obfs", "obfs-password"]);
  for (const key of query.keys()) {
    if (!known.has(key) || query.getAll(key).length !== 1) throw invalid("Hy2 含有尚未支持或重复的参数。");
  }
  if (query.has("security") && query.get("security") !== "tls") throw invalid("Hy2 需要 TLS。");
  const auth = decodeURIComponent(url.username) + (url.password ? ":" + decodeURIComponent(url.password) : "");
  const params = { password: auth };
  if (query.get("sni")) params.sni = validHost(query.get("sni"));
  if (query.get("vcn")) params["server-cert-verify-name"] = validHost(query.get("vcn"));
  if (query.has("insecure")) {
    const insecure = query.get("insecure");
    if (!["0", "1", "true", "false"].includes(insecure)) throw invalid("Hy2 证书校验参数不正确。");
    if (["1", "true"].includes(insecure)) params["skip-cert-verify"] = "true";
  }
  if (query.has("pinSHA256")) {
    const pin = query.get("pinSHA256").replaceAll(":", "");
    if (!/^[a-f0-9]{64}$/i.test(pin)) throw invalid("Hy2 需要单个 SHA-256 证书指纹。");
    params["server-cert-fingerprint-sha256"] = pin.toUpperCase();
  }
  if (query.has("alpn")) {
    const alpn = query.get("alpn");
    if (!alpn.split(",").every((value) => /^[a-z0-9./_-]+$/i.test(value))) throw invalid("ALPN 格式不正确。");
    params.alpn = alpn;
  }
  if (query.has("obfs") || query.has("obfs-password")) {
    const obfs = query.get("obfs");
    if (!["salamander", "gecko"].includes(obfs) || !query.get("obfs-password")) throw invalid("Hy2 混淆类型或密码不受支持。");
    params[`${obfs}-password`] = query.get("obfs-password");
  }
  const warnings = query.get("fp") ? ["Surge 的 Hy2 使用 QUIC TLS，链接中的浏览器指纹未写入配置。"] : [];
  const value = ["hysteria2", validHost(url.hostname), String(port),
    ...Object.entries(params).map(([key, value]) => `${key}=${quoteValue(value)}`)].join(", ");
  return { ...parseLine(`${validName(name || decodeURIComponent(url.hash.slice(1)) || "导入节点")} = ${value}`), warnings };
}

function convertVless(link, name) {
  let url;
  try { url = new URL(link); }
  catch { throw invalid("VLESS 链接格式不正确。"); }
  const id = decodeURIComponent(url.username);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw invalid("VLESS UUID 不正确。");
  if (url.password || !["", "/"].includes(url.pathname)) throw invalid("VLESS 链接格式不正确。");
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid("VLESS 端口不正确。");
  const query = url.searchParams;
  const known = new Set(["type", "security", "encryption", "flow", "sni", "pbk", "sid", "fp", "spx", "headerType", "alpn", "support-x25519mlkem768"]);
  for (const key of query.keys()) {
    if (!known.has(key) || query.getAll(key).length !== 1) throw invalid("VLESS 含有尚未支持或重复的参数。");
  }
  const mlkemHint = query.get("support-x25519mlkem768");
  if (mlkemHint !== null && !["true", "false"].includes(mlkemHint)) {
    throw invalid("support-x25519mlkem768 必须为 true 或 false。");
  }
  if (!["tcp", "raw"].includes(query.get("type") || "tcp")
    || query.get("security") !== "reality" || (query.get("encryption") || "none") !== "none"
    || !["xtls-rprx-vision", "xtls-rprx-vision-udp443"].includes(query.get("flow"))
    || !["", "none"].includes(query.get("headerType") || "")) {
    throw invalid("VLESS 链接导入支持 TCP / RAW + REALITY + Vision。");
  }
  const publicKey = query.get("pbk") || "";
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(publicKey)) throw invalid("REALITY 公钥格式不正确。");
  const shortId = query.get("sid") || "";
  if (!/^(?:[a-f0-9]{2}){0,8}$/i.test(shortId)) throw invalid("REALITY short ID 格式不正确。");
  const params = {
    username: id.toLowerCase(), flow: query.get("flow"), sni: validHost(query.get("sni")),
    "reality-public-key": publicKey, "reality-short-id": shortId.toLowerCase(),
  };
  if (query.get("alpn")) {
    const alpn = query.get("alpn").split(",");
    if (alpn.some((value) => !/^[a-z0-9./_-]+$/i.test(value))) throw invalid("ALPN 格式不正确。");
    params.alpn = alpn.join(",");
  }
  const value = ["vless", validHost(url.hostname), String(port),
    ...Object.entries(params).map(([key, value]) => `${key}=${quoteValue(value)}`)].join(", ");
  const warnings = ["VLESS + REALITY + Vision 需要 Surge iOS 6.0.0+ / Mac 6.12.0+，REALITY 使用内置 Chrome ClientHello。"];
  if (mlkemHint === "false") warnings.push("链接要求关闭 X25519MLKEM768。Surge 会自动协商 REALITY 密钥交换，Mihomo 订阅默认启用 X25519MLKEM768。");
  return { ...parseLine(`${validName(name || decodeURIComponent(url.hash.slice(1)) || "导入节点")} = ${value}`), warnings };
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
  return /[(),;#\s]/.test(value) ? `"${value}"` : value;
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
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) throw invalid("支持 HTTPS 订阅、VMess、VLESS、Hy2 链接和 Surge 节点行。");
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
