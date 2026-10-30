import { stringify } from "yaml";
import { convertClashNode } from "./clash-nodes.js";
import { convertClashRules } from "./clash-rules.js";
import { HttpError } from "./errors.js";
import { applyRuleSetVisibility } from "./rule-visibility.js";
import { positiveInteger, splitSurgeList, surgeAssignment, surgeBoolean, surgeOptions, surgeSections } from "./surge-format.js";

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
  const hostDns = convertHostDns(sections.get("host") ?? [], warn);
  if (Object.keys(hostDns).length) config.dns["nameserver-policy"] = hostDns;
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
  const { rules, providers } = await convertClashRules(sections.get("rule") ?? [], policies, requestUrl, token, warn);
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
  const config = { "mixed-port": 7890, "allow-lan": false, mode: "rule", "log-level": "warning", ipv6: false };
  const dns = { enable: true, "enhanced-mode": "redir-host", ipv6: false };
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
    if (value === "per-policy") {
      warn("General block-quic: per-policy mode unsupported; setting omitted");
      return;
    }
    if (!["all-proxy", "all", "always-allow"].includes(value)) throw new Error();
    // ProjectClash checks the detected protocol and the selected terminal outbound.
    config["x-clash-block-quic"] = value;
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
  read("hijack-dns", (value) => { config.tun = { "dns-hijack": splitSurgeList(value).map((entry) => entry.replace(/^\*/, "any")) }; });
  read("geoip-maxmind-url", (value) => {
    if (new URL(value).protocol !== "https:") throw new Error();
    config["geodata-mode"] = false;
    config["geox-url"] = { mmdb: value };
  });
  consumed.add("test-timeout");
  consumed.add("proxy-test-url");
  for (const key of general.keys()) if (!consumed.has(key)) warn(`General ${key}: unsupported setting omitted`);
  config.dns = dns;
  return config;
}

function convertHostDns(lines, warn) {
  const policies = Object.create(null);
  for (const [index, line] of lines.entries()) {
    try {
      const [name, value] = surgeAssignment(line);
      if (!/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(name) || !value.startsWith("server:")) throw new Error();
      const servers = splitSurgeList(value.slice(7));
      if (servers.some((server) => !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(server)
        || server.split(".").some((part) => Number(part) > 255))) throw new Error();
      // Surge *.example.com includes all subdomain levels, unlike Mihomo's *.
      const pattern = name.toLowerCase().replace(/^\*\./, ".");
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
      if ([...options.keys()].some((key) => !["url", "interval", "timeout", "tolerance", "hidden", "icon-url", "include-all-proxies"].includes(key))) throw new Error();
      const members = parts.filter((part) => !part.includes("="));
      if (surgeBoolean(options.get("include-all-proxies") ?? "false")) members.push(...nodeNames);
      const smart = type === "smart";
      const group = { name, type: smart ? "url-test" : type, proxies: [...new Set(smart ? members.filter((member) => nodeNames.has(member)) : members)] };
      if (smart) warn(`Proxy Group entry ${index + 1}: smart approximated by url-test; connection-quality scoring unavailable`);
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
