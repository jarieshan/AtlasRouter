import { ASSETS } from "./generated/assets.js";
import { renderProxyLines, subscriptionNodes } from "./nodes.js";
import { subscriptionPath } from "./routes.js";
import { buildSubscriptionUrl } from "./subscription-options.js";
import { magicRuleUrl } from "./magic-rules.js";
import { applyRuleSetVisibility } from "./rule-visibility.js";
import { inheritBranch } from "./branch-query.js";
import { repositoryTemplate } from "./repository-rules.js";
import { splitSurgeList, surgeSections, surgeValue } from "./surge-format.js";

const REGION_ORDER = { US: 0, HK: 1, SG: 2, JP: 3 };
const IP_TYPE_ORDER = { ISP: 0, WARP: 1, IDC: 2 };
const IDC_FIRST_IP_TYPE_ORDER = { IDC: 0, WARP: 1, ISP: 2 };
const WARP_FIRST_IP_TYPE_ORDER = { WARP: 0, IDC: 1, ISP: 2 };

export function renderSurgeProfile({ requestUrl, token, nodes, groups, options = {}, showAllGroups = false, repositoryRulesRef = "master" }) {
  const namedNodes = subscriptionNodes(nodes);
  const byName = new Map(nodes.map((node, index) => [node.name, namedNodes[index]]));
  nodes = namedNodes;
  groups = groups.map((group) => ({ ...group, nodes: group.nodes.map((node) => byName.get(node.name)) }));
  const idcNames = nodes.filter((node) => node.ipType === "IDC").sort(compareNodes).map((node) => node.name);
  const doh = options.doh ?? true;
  // Clash has no DNS scripts, so zslab.ai keeps plain DNS there.
  const clash = options.client === "clash";
  const replacements = {
    MANAGED_CONFIG: `#!MANAGED-CONFIG ${buildSubscriptionUrl(requestUrl, token, options)} interval=86400 strict=false`,
    WIFI_ASSIST: String(options.wifiAssist ?? false),
    MODULE_URL_LINES: renderModuleUrlLines(requestUrl, token, `${subscriptionPath(requestUrl)}/modules`),
    ZSLAB_DNS: clash ? "server:223.5.5.5, 119.29.29.29" : "script:node-dns",
    PROXY_LINES: renderProxyLines([...nodes].sort(compareNodes)),
    RULE_LINES: renderPoolRules(ASSETS.rules, idcNames.length ? "DoH Proxy" : "REJECT"),
    US_ISP_POLICY: groups.find(({ nodes }) => nodes[0]?.region === "US" && nodes[0]?.ipType === "ISP")?.group ?? "REJECT",
    ...Object.fromEntries(Object.keys(ASSETS.magicRules).map((name) => [
      `RULESET_${name}`, magicRuleUrl(name, "surge", requestUrl),
    ])),
  };
  const template = renderPoolTemplate(groups, idcNames, repositoryRulesRef).replace(/(^\[General\]\n)([\s\S]*?)(?=^\[)/m, (_, heading, body) => {
    let general = body.replace(/^[ \t]*(?:#[ \t]*)?(encrypted-dns-(?:server|follow-outbound-mode)[ \t]*=.+)$/gm, (_, setting) => `${doh ? "" : "# "}${setting}`);
    if (options.tencentOa) general = general.replace(/^skip-proxy[ \t]*=.*$/m, () => ASSETS.tencentOa.match(/^skip-proxy[ \t]*=.*$/m)[0]);
    return heading + general;
  }).replace(/^\[Script\]\n[\s\S]*?(?=^\[)/m, (section) => clash ? "" : section);
  const profile = replaceTemplate(template, {
    ...replacements,
    DOMESTIC_RULESET_DNS_LINES: (rendered) => renderDomesticRuleSetDns(rendered, doh),
  });
  return applyRuleSetVisibility(profile, { showAllGroups });
}

function renderPoolTemplate(groups, idcNames, repositoryRulesRef) {
  const orderedGroups = [...groups].sort(compareNodeGroups);
  const groupNamesByIpType = (order, preferredRegion) => [...orderedGroups].sort((a, b) =>
    (a.nodes[0].region !== preferredRegion) - (b.nodes[0].region !== preferredRegion)
    || order[a.nodes[0].ipType] - order[b.nodes[0].ipType]
    || compareNodeGroups(a, b)).map(({ group }) => group).join(", ");
  const section = replaceTemplate(ASSETS.poolGroups, {
    POOL_GROUP_LINES: orderedGroups.map(({ group, nodes }) => {
      const names = nodes.map((node) => node.name);
      return `${group} = fallback, ${names.join(", ")}, interval=300${nodes[0].ipType === "ISP" ? "" : ", hidden=true"}`;
    }).join("\n"),
    // An empty Surge Smart group substitutes DIRECT, so omit it and reject its traffic instead.
    DOH_PROXY_GROUP_LINE: idcNames.length ? `DoH Proxy = smart, ${idcNames.join(", ")}, icon-url=https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Server.png, hidden=true` : "",
    POOL_GROUPS: groupNamesByIpType(IP_TYPE_ORDER),
    IDC_FIRST_POOL_GROUPS: groupNamesByIpType(IDC_FIRST_IP_TYPE_ORDER),
    WARP_FIRST_POOL_GROUPS: groupNamesByIpType(WARP_FIRST_IP_TYPE_ORDER),
    HK_FIRST_POOL_GROUPS: groupNamesByIpType(IP_TYPE_ORDER, "HK"),
  });
  return repositoryTemplate(repositoryRulesRef).replace(/^\[Proxy Group\]\n[\s\S]*?(?=^\[Rule\]$)/m, () => `${section}\n`);
}

function compareNodes(left, right) {
  return (REGION_ORDER[left.region] ?? 4) - (REGION_ORDER[right.region] ?? 4)
    || left.region.localeCompare(right.region)
    || IP_TYPE_ORDER[left.ipType] - IP_TYPE_ORDER[right.ipType];
}

function compareNodeGroups(a, b) {
  return compareNodes(a.nodes[0], b.nodes[0]);
}

function renderPoolRules(rules, dohPolicy) {
  return rules.split("\n").map((line) => {
    if (line.trimStart().startsWith("#")) return line;
    const parts = line.split(",");
    if (parts[2]?.trim() === "DoH Proxy") parts[2] = dohPolicy;
    return parts.join(",");
  }).join("\n");
}

function renderDomesticRuleSetDns(profile, doh) {
  const servers = doh ? "https://dns.alidns.com/dns-query, https://doh.pub/dns-query" : "223.5.5.5, 119.29.29.29";
  const mappings = new Set();
  for (const line of surgeSections(profile).get("rule") ?? []) {
    if (!/^(?:RULE-SET|DOMAIN-SET)\s*,/.test(line)) continue;
    const [type, source, policy] = splitSurgeList(line);
    if (!/^("?)(?:DIRECT|WeChat|iCloud)\1(?=$|\s*[#;]|\s*\/\/)/.test(policy)) continue;
    const url = surgeValue(source);
    if (/^https?:\/\//i.test(url)) mappings.add(`${type}:${url} = server:${servers}`);
  }
  return [...mappings].join("\n");
}

export function getModule(name) {
  return ASSETS.modules[name] ?? null;
}

function renderModuleUrlLines(requestUrl, token, modulePath) {
  const moduleEntries = Object.entries(ASSETS.modules).sort(([left], [right]) => left.localeCompare(right));
  if (moduleEntries.length === 0) {
    return "# - None";
  }

  return moduleEntries
    .map(([moduleName, content]) => `# - ${moduleDisplayName(moduleName, content)}: ${buildUrl(requestUrl, `${modulePath}/${moduleName}`, token)}`)
    .join("\n");
}

function moduleDisplayName(moduleName, content) {
  const name = content.match(/^#!name=(.+)$/m);
  return name ? name[1].trim() : moduleName;
}

function buildUrl(requestUrl, pathname, token) {
  const url = new URL(requestUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", token);
  return inheritBranch(url, requestUrl).toString();
}

function replaceTemplate(template, replacements) {
  let output = template;
  for (const [name, value] of Object.entries(replacements)) {
    const replacement = typeof value === "function" ? value(output) : value;
    output = output.replaceAll(`{{${name}}}`, () => replacement);
  }

  const unresolved = output.match(/{{[A-Za-z0-9_]+}}/g);
  if (unresolved) {
    throw new Error(`Unresolved Surge template placeholders: ${unresolved.join(", ")}`);
  }

  return output.trimEnd() + "\n";
}
