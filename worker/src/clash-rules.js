import { ASSETS } from "./generated/assets.js";
import { HttpError } from "./errors.js";
import { subscriptionPath } from "./routes.js";
import { positiveInteger, splitSurgeList, surgeValue } from "./surge-format.js";
import { nativeMagicRuleSource } from "./magic-rules.js";
import { inheritBranch } from "./branch-query.js";

const RULE_TYPES = new Set(["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "DOMAIN-WILDCARD", "DOMAIN-REGEX", "IP-CIDR", "IP-CIDR6", "IP-ASN", "GEOIP", "SRC-IP-CIDR", "SRC-PORT", "DST-PORT", "PROCESS-NAME", "PROCESS-PATH"]);
const ALIASES = new Map([["DEST-PORT", "DST-PORT"]]);
// Public lists in this repository; Mihomo reads them as classical text and skips unsupported lines itself.
const REPOSITORY_RULE_SET = /^https:\/\/cdn\.jsdelivr\.net\/gh\/jarieshan\/AtlasRouter@[A-Za-z0-9._-]+\/surge\/rule-sets\/[A-Za-z0-9-]+\.list$/;
let registeredSources;

export async function ruleSource(parts) {
  if (!["RULE-SET", "DOMAIN-SET"].includes(parts[0])) return null;
  let url;
  try { url = new URL(parts[1]); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|arpa)$/i.test(url.hostname)) return null;
  const kind = parts[0];
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${kind}:${url}`));
  const id = `rule-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
  return { id, url: url.toString(), kind };
}

export async function findClashRuleSource(filename) {
  if (!/^rule-[a-f0-9]{32}\.txt$/.test(filename)) return null;
  // Only sources declared in the deployed Surge configuration are fetchable.
  registeredSources ??= (async () => {
    const sources = new Map();
    for (const line of `${ASSETS.template}\n${ASSETS.rules}`.split(/\r?\n/)) {
      if (!/^\s*(?:RULE-SET|DOMAIN-SET),/.test(line)) continue;
      try {
        const source = await ruleSource(splitSurgeList(line.trim()));
        if (source) sources.set(`${source.id}.txt`, source);
      } catch { /* Unsupported source lines are omitted by the converter. */ }
    }
    return sources;
  })();
  return (await registeredSources).get(filename) ?? null;
}

function simpleRule(parts) {
  const type = ALIASES.get(parts[0]) ?? parts[0];
  if (!RULE_TYPES.has(type) || !parts[1]) return null;
  return `${type},${surgeValue(parts[1])}`;
}

function flags(parts) {
  if (parts.some((value) => value !== "no-resolve")) return null;
  return parts.length ? ",no-resolve" : "";
}

export async function convertClashRules(lines, policies, requestUrl, token, warn, { udpless = new Set(), udpFallback = "REJECT" } = {}) {
  const rules = [];
  const providers = Object.create(null);
  let twins = 0;
  // Mihomo skips a matched rule whose outbound cannot relay UDP and keeps matching, ending at
  // DIRECT; Surge applies udp-policy-not-supported-behaviour instead. Only skipped UDP reaches the twin.
  const push = (condition, policy, suffix = "") => {
    rules.push(`${condition},${policy}${suffix}`);
    if (!udpless.has(policy)) return;
    twins += 1;
    if (condition === "MATCH") rules.push(`NETWORK,UDP,${udpFallback}`);
    else rules.push(/[()]/.test(condition) ? `${condition},${udpFallback}${suffix}` : `AND,((NETWORK,UDP),(${condition}${suffix})),${udpFallback}`);
  };
  for (const [index, line] of lines.entries()) {
    try {
      const parts = splitSurgeList(line);
      if (parts[0] === "FINAL") {
        if (!policies.has(parts[1])) throw new Error();
        if (parts.length > 2) warn(`Rule entry ${index + 1}: FINAL options omitted`);
        push("MATCH", parts[1]);
        continue;
      }
      // Filtering unsupported nodes must not bypass the required DoH or US ISP outbound.
      if (["DoH Proxy", "🇺🇸USA-ISP"].includes(parts[2]) && !policies.has(parts[2])) {
        const label = parts[2] === "DoH Proxy" ? "DoH" : "US ISP";
        parts[2] = "REJECT";
        warn(`Rule entry ${index + 1}: no compatible ${label} proxy; using REJECT`);
      }
      if (!policies.has(parts[2])) throw new Error();
      if (["RULE-SET", "DOMAIN-SET"].includes(parts[0])) {
        if (parts[1] === "LAN" && parts[0] === "RULE-SET") {
          const suffix = flags(parts.slice(3));
          if (suffix === null) throw new Error();
          push("DOMAIN-SUFFIX,local", parts[2]);
          // Explicit local networks do not depend on the downloaded GeoIP database.
          // Keep in sync with https://manual.nssurge.com/rules/ruleset.html#lan.
          for (const network of ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "224.0.0.0/4"]) {
            push(`IP-CIDR,${network}`, parts[2], suffix);
          }
          for (const network of ["::1/128", "fc00::/7", "fe80::/10"]) push(`IP-CIDR6,${network}`, parts[2], suffix);
          continue;
        }
        const source = await ruleSource(parts);
        if (!source) throw new Error();
        let interval = 86400;
        const extra = [];
        for (const part of parts.slice(3)) {
          if (part.startsWith("update-interval=")) interval = positiveInteger(part.slice(16));
          else extra.push(part);
        }
        const suffix = flags(extra);
        if (suffix === null) throw new Error();
        const native = nativeMagicRuleSource(source, requestUrl);
        const repository = !native && source.kind === "RULE-SET" && REPOSITORY_RULE_SET.test(source.url);
        const url = native ? new URL(native.url) : repository ? new URL(source.url)
          : inheritBranch(new URL(`${subscriptionPath(requestUrl)}/rules/${source.id}.txt`, requestUrl), requestUrl);
        if (!native && !repository) url.searchParams.set("token", token);
        let name = native?.name ?? source.id;
        if (providers[name] && providers[name].url !== url.toString()) name = `${name}-${source.id.slice(5)}`;
        providers[name] = { type: "http", behavior: "classical", format: native?.format ?? "text", url: url.toString(), interval };
        push(`RULE-SET,${name}`, parts[2], suffix);
        continue;
      }
      const rule = simpleRule(parts);
      const suffix = flags(parts.slice(3));
      if (!rule || suffix === null) throw new Error();
      push(rule, parts[2], suffix);
    } catch { warn(`Rule entry ${index + 1}: unsupported rule or missing policy omitted`); }
  }
  if (!rules.some((rule) => rule.startsWith("MATCH,"))) throw new HttpError(422, "Clash conversion has no usable final policy");
  if (twins) warn(`Rules: ${twins} rules may select a node without UDP relay; their UDP falls back to ${udpFallback} as in Surge`);
  return { rules, providers };
}

export function convertClashRuleSet(text, kind = "RULE-SET") {
  if (text.trimStart().startsWith("<")) throw new HttpError(502, "Rule source did not return a rule list");
  const rules = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    try {
      if (kind === "DOMAIN-SET") {
        if (!/^\.?[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i.test(line)) throw new Error();
        rules.push(`${line.startsWith(".") ? "DOMAIN-SUFFIX" : "DOMAIN"},${line.replace(/^\./, "")}`);
      } else {
        const parts = splitSurgeList(line);
        const rule = simpleRule(parts);
        const suffix = flags(parts.slice(2));
        if (!rule || suffix === null) throw new Error();
        rules.push(rule + suffix);
      }
    } catch { skipped += 1; }
  }
  return `# AtlasRouter: ${skipped} unsupported rule entries omitted\n${rules.join("\n")}\n`;
}

export async function downloadClashRuleSet(source, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(source.url, {
      redirect: "manual", signal: controller.signal,
      headers: { accept: "text/plain", "user-agent": "AtlasRouter-Rules/1.0" },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
    return convertClashRuleSet(await new Blob(chunks).text(), source.kind);
  } catch { throw new HttpError(502, "Unable to load compatible rule list"); }
  finally { clearTimeout(timer); }
}
