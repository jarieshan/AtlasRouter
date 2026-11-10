import { stringify } from "yaml";
import { convertClashNode } from "./clash-nodes.js";
import { convertClashRules, ruleSource } from "./clash-rules.js";
import { HttpError } from "./errors.js";
import { nativeMagicRuleSource } from "./magic-rules.js";
import { applyRuleSetVisibility } from "./rule-visibility.js";
import { orderedSmartPriority, positiveInteger, SMART_PRIORITY_SCHEMES, splitSurgeList, surgeAssignment, surgeBoolean, surgeOptions, surgeSections } from "./surge-format.js";

export async function convertSurgeToClash(profile, { requestUrl, token }) {
  const sections = surgeSections(applyRuleSetVisibility(profile));
  const warnings = [];
  const warn = (message) => warnings.push(message);
  const general = new Map();
  for (const [index, line] of (sections.get("general") ?? []).entries()) {
    try { for (const entry of surgeOptions([line])) general.set(...entry); }
    catch { warn(`General entry ${index + 1}: invalid setting omitted`); }
  }
  const config = convertGeneral(general, warn);
  const proxies = [];
  for (const [index, line] of (sections.get("proxy") ?? []).entries()) {
    try {
      const node = convertClashNode(line, (message) => warn(`Proxy entry ${index + 1}: ${message}`));
      if (["DIRECT", "REJECT"].includes(node.name) || proxies.some(({ name }) => name === node.name)) throw new Error();
      proxies.push(node);
    } catch { warn(`Proxy entry ${index + 1}: unsupported protocol, parameter or invalid value; node omitted`); }
  }
  if (!proxies.length) throw new HttpError(422, "No nodes can be converted to Clash");
  const groups = convertGroups(sections.get("proxy group") ?? [], proxies, general, warn);
  const policies = new Set(["DIRECT", "REJECT", ...proxies.map(({ name }) => name), ...groups.map(({ name }) => name)]);
  const udp = { udpless: udpIncapablePolicies(proxies, groups), udpFallback: udpFallbackPolicy(general, warn) };
  const { rules, providers } = await convertClashRules(sections.get("rule") ?? [], policies, requestUrl, token, warn, udp);
  const hostDns = await convertHostDns(sections.get("host") ?? [], providers, general, requestUrl, warn);
  config.dns["nameserver-policy"] = { "use-application-dns.net": "rcode://name_error", ...hostDns };
  for (const name of sections.keys()) {
    if (!["general", "host", "proxy", "proxy group", "rule"].includes(name)) {
      // Section names are syntax labels, never include section contents in diagnostics.
      warn(`Section ${/^[a-z -]{1,40}$/.test(name) ? name : "unknown"}: omitted`);
    }
  }
  return { config: { ...config, proxies, "proxy-groups": groups, "rule-providers": providers, rules }, warnings };
}

export async function renderClashProfile(profile, context) {
  const { config, warnings } = await convertSurgeToClash(profile, context);
  const notes = ["# AtlasRouter - Clash / Mihomo", ...warnings.map((warning) => `# ${warning}`)];
  return `${notes.join("\n")}\n${stringify(config, { lineWidth: 0, aliasDuplicateObjects: false })}`;
}

function convertGeneral(general, warn) {
  // Surge's enhanced mode answers with fake IPs and keeps the mapping across restarts, so
  // no-resolve IP rules never match domain traffic and app lookups never wait for DoH.
  // Windows' connectivity probe needs a real answer; Surge answers Firefox's DoH canary itself.
  const config = { "mixed-port": 7890, "allow-lan": false, mode: "rule", "log-level": "warning", ipv6: false, profile: { "store-fake-ip": true } };
  const dns = { enable: true, "enhanced-mode": "fake-ip", "fake-ip-filter": ["+.msftconnecttest.com", "+.msftncsi.com", "use-application-dns.net"], ipv6: false };
  const consumed = new Set();
  const read = (key, convert) => {
    consumed.add(key);
    if (!general.has(key)) return;
    try { convert(general.get(key)); }
    catch { warn(`General ${key}: invalid value omitted`); }
  };
  read("loglevel", (value) => {
    const level = new Map([["verbose", "debug"], ["info", "info"], ["notify", "warning"], ["warning", "warning"]]).get(value);
    if (!level) throw new Error();
    config["log-level"] = level;
  });
  read("ipv6", (value) => { config.ipv6 = dns.ipv6 = surgeBoolean(value); });
  read("block-quic", (value) => {
    if (!["per-policy", "all-proxy", "all", "always-allow"].includes(value)) throw new Error();
    // ProjectClash checks the detected protocol and the selected terminal outbound.
    // Converted proxies never carry block-quic overrides, so per-policy means Surge's
    // default: proxies block QUIC (adaptively on newer clients) and DIRECT allows it.
    config["x-clash-block-quic"] = value === "per-policy" ? "all-proxy" : value;
    if (value === "per-policy") warn("General block-quic: per-policy adaptive mode approximated by all-proxy");
    warn("General block-quic: requires ProjectClash x-clash-block-quic support; other cores may ignore it");
  });
  read("read-etc-hosts", (value) => { dns["use-system-hosts"] = surgeBoolean(value); });
  let plain = ["system"];
  read("dns-server", (value) => { plain = splitSurgeList(value); });
  dns.nameserver = plain;
  let encrypted;
  read("encrypted-dns-server", (value) => {
    const servers = splitSurgeList(value);
    if (!servers.length || servers.some((entry) => !/^(https|tls|quic):\/\//.test(entry))) throw new Error();
    encrypted = servers;
    dns.nameserver = encrypted;
    const bootstrap = plain.filter((entry) => entry !== "system" && !entry.includes("://"));
    if (bootstrap.length) dns["default-nameserver"] = bootstrap;
  });
  dns["proxy-server-nameserver"] = [...dns.nameserver];
  read("encrypted-dns-follow-outbound-mode", (value) => {
    if (!surgeBoolean(value) || !encrypted) return;
    // Route encrypted queries only; keep node bootstrap and Host UDP DNS direct.
    dns.nameserver = encrypted.map((server) => `${server}#RULES`);
    dns["proxy-server-nameserver"] = [...plain];
  });
  // Surge's virtual interface takes over the system resolver; hijack-dns only adds hardcoded targets.
  config.tun = { "dns-hijack": ["any:53", "tcp://any:53"] };
  read("hijack-dns", (value) => {
    const extra = splitSurgeList(value).map((entry) => {
      const [, host, port = "53"] = entry.match(/^(\*|[\w.-]+)(?::(\d{1,5}))?$/) ?? [];
      if (!host) throw new Error();
      return port === "53" ? [] : [`${host === "*" ? "any" : host}:${port}`];
    });
    config.tun["dns-hijack"].push(...extra.flat());
  });
  read("geoip-maxmind-url", (value) => {
    if (new URL(value).protocol !== "https:") throw new Error();
    config["geodata-mode"] = false;
    config["geox-url"] = { mmdb: value };
  });
  consumed.add("test-timeout");
  consumed.add("proxy-test-url");
  consumed.add("udp-policy-not-supported-behaviour");
  for (const key of general.keys()) if (!consumed.has(key)) warn(`General ${key}: unsupported setting omitted`);
  config.dns = dns;
  return config;
}

function udpFallbackPolicy(general, warn) {
  const value = (general.get("udp-policy-not-supported-behaviour") ?? "REJECT").toUpperCase();
  if (["DIRECT", "REJECT"].includes(value)) return value;
  warn("General udp-policy-not-supported-behaviour: invalid value; Surge default REJECT used");
  return "REJECT";
}

// Groups resolve to their current member at connection time, so any path to such a node counts.
function udpIncapablePolicies(proxies, groups) {
  const udpless = new Set(proxies.filter(({ udp }) => udp !== true).map(({ name }) => name));
  for (let changed = true; changed;) {
    changed = false;
    for (const { name, proxies: members } of groups) {
      if (!udpless.has(name) && members.some((member) => udpless.has(member))) { udpless.add(name); changed = true; }
    }
  }
  return udpless;
}

async function convertHostDns(lines, providers, general, requestUrl, warn) {
  const policies = Object.create(null);
  for (const [index, line] of lines.entries()) {
    try {
      const [name, value] = surgeAssignment(line);
      if (!value.startsWith("server:")) throw new Error();
      const servers = splitSurgeList(value.slice(7)).map((server) => {
        if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(server)
          && server.split(".").every((part) => Number(part) <= 255)) return server;
        const url = new URL(server);
        if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
        return url.toString() + (surgeBoolean(general.get("encrypted-dns-follow-outbound-mode") ?? "false") ? "#RULES" : "");
      });
      let pattern;
      const reference = name.match(/^(DOMAIN-SET|RULE-SET):(.+)$/);
      if (reference) {
        const source = await ruleSource([reference[1], reference[2]]);
        const provider = source && (nativeMagicRuleSource(source, requestUrl)?.name ?? source.id);
        if (!provider || !Object.hasOwn(providers, provider)) throw new Error();
        pattern = `rule-set:${provider}`;
      } else {
        if (!/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(name)) throw new Error();
        // Surge *.example.com includes all subdomain levels, unlike Mihomo's *.
        pattern = name.toLowerCase().replace(/^\*\./, ".");
      }
      policies[pattern] ??= servers;
    } catch { warn(`Host entry ${index + 1}: unsupported DNS mapping omitted`); }
  }
  return policies;
}

function convertGroups(lines, proxies, general, warn) {
  const groups = [];
  const nodeNames = new Set(proxies.map(({ name }) => name));
  for (const [index, line] of lines.entries()) {
    try {
      const [name, value] = surgeAssignment(line);
      const [type, ...parts] = splitSurgeList(value);
      if (!["select", "fallback", "url-test", "smart"].includes(type) || nodeNames.has(name)
        || ["DIRECT", "REJECT"].includes(name) || groups.some((group) => group.name === name)) throw new Error();
      const options = surgeOptions(parts.filter((part) => part.includes("=")));
      if ([...options.keys()].some((key) => !["url", "interval", "timeout", "tolerance", "hidden", "icon-url", "include-all-proxies", "policy-regex-filter", "policy-priority"].includes(key))) throw new Error();
      const members = parts.filter((part) => !part.includes("="));
      const policyFilter = new RegExp(options.get("policy-regex-filter") ?? "");
      // Surge filters included policies only; explicitly listed members are unchanged.
      if (surgeBoolean(options.get("include-all-proxies") ?? "false")) members.push(...[...nodeNames].filter((name) => policyFilter.test(name)));
      const smart = type === "smart";
      const orderedSmart = options.has("policy-priority");
      // Only the generated exact-name schemes have a defined order-preserving fallback.
      if (orderedSmart && (!smart || !SMART_PRIORITY_SCHEMES.some((scheme) =>
        options.get("policy-priority") === orderedSmartPriority(members, scheme)))) throw new Error();
      const group = { name, type: smart ? (orderedSmart ? "fallback" : "url-test") : type, proxies: [...new Set(smart ? members.filter((member) => nodeNames.has(member)) : members)] };
      if (smart) warn(orderedSmart
        ? `Proxy Group entry ${index + 1}: ordered smart converted to fallback; member order retained, weighted scoring unavailable`
        : `Proxy Group entry ${index + 1}: smart approximated by url-test; connection-quality scoring unavailable`);
      if (type !== "select") {
        group.url = general.get("proxy-test-url") ?? "http://bing.com/";
        group.interval = smart ? 300 : positiveInteger(options.get("interval") ?? "600");
        group.timeout = positiveInteger(general.get("test-timeout") ?? "5") * 1000;
        // Surge's group timeout filters measured latency, unlike Mihomo's test deadline.
        if (options.has("timeout")) warn(`Proxy Group entry ${index + 1}: timeout latency filter omitted; test-timeout used`);
        if (options.has("url") && options.get("url") !== group.url) warn(`Proxy Group entry ${index + 1}: legacy url ignored; proxy-test-url used`);
        if (group.type === "url-test") {
          const tolerance = smart ? "0" : options.get("tolerance") ?? "100";
          if (!/^\d+$/.test(tolerance) || !Number.isSafeInteger(Number(tolerance))) throw new Error();
          group.tolerance = Number(tolerance);
        }
      }
      if (options.has("hidden")) group.hidden = surgeBoolean(options.get("hidden"));
      if (options.has("icon-url")) group.icon = options.get("icon-url");
      groups.push(group);
    } catch { warn(`Proxy Group entry ${index + 1}: unsupported or invalid group omitted`); }
  }
  const byName = new Map(groups.map((group) => [group.name, group]));
  const cycles = new Set();
  const visited = new Set();
  function visit(name, stack = []) {
    if (stack.includes(name)) { for (const member of stack.slice(stack.indexOf(name))) cycles.add(member); return; }
    if (visited.has(name)) return;
    visited.add(name);
    for (const member of byName.get(name)?.proxies ?? []) if (byName.has(member)) visit(member, [...stack, name]);
  }
  for (const name of byName.keys()) visit(name);
  for (const name of cycles) byName.delete(name);
  if (cycles.size) warn(`Proxy Groups: ${cycles.size} cyclic groups omitted`);
  let changed = true;
  while (changed) {
    changed = false;
    const valid = new Set(["DIRECT", "REJECT", ...nodeNames, ...byName.keys()]);
    for (const [name, group] of byName) {
      const members = group.proxies.filter((member) => valid.has(member));
      if (members.length !== group.proxies.length) warn("Proxy Group: unavailable members omitted");
      group.proxies = members;
      if (!members.length) { byName.delete(name); changed = true; warn("Proxy Group: empty group omitted"); }
    }
  }
  return [...byName.values()];
}
