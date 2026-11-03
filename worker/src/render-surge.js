import { ASSETS } from "./generated/assets.js";
import { renderProxyLines } from "./nodes.js";
import { subscriptionPath } from "./routes.js";
import { buildSubscriptionUrl } from "./subscription-options.js";
import { magicRuleUrl } from "./magic-rules.js";
import { appendTencentOaSkipProxy } from "./tencent-oa.js";
import { applyRuleSetVisibility } from "./rule-visibility.js";
import { orderedSmartPriority } from "./surge-format.js";
import { inheritBranch } from "./branch-query.js";

const REGION_ORDER = { US: 0, HK: 1, SG: 2, JP: 3 };
const IP_TYPE_ORDER = { ISP: 0, WARP: 1, IDC: 2 };
const IDC_FIRST_IP_TYPE_ORDER = { IDC: 0, WARP: 1, ISP: 2 };
const WARP_FIRST_IP_TYPE_ORDER = { WARP: 0, IDC: 1, ISP: 2 };

export function renderSurgeProfile({ requestUrl, token, nodes, groups, options = {}, smartPriorityScheme, showAllGroups = false }) {
  const idcNames = nodes.filter((node) => node.ipType === "IDC").sort(compareNodes).map((node) => node.name);
  const replacements = {
    MANAGED_CONFIG: `#!MANAGED-CONFIG ${buildSubscriptionUrl(requestUrl, token, options)} interval=86400 strict=false`,
    MODULE_URL_LINES: renderModuleUrlLines(requestUrl, token, `${subscriptionPath(requestUrl)}/modules`),
    PROXY_LINES: renderProxyLines([...nodes].sort(compareNodes)),
    RULE_LINES: renderPoolRules(ASSETS.rules, idcNames.length ? "DoH Proxy" : "REJECT"),
    DIRECT_DNS_SERVERS: (options.doh
      ? ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"]
      : ["223.5.5.5", "119.29.29.29"]).join(", "),
    ...Object.fromEntries(Object.keys(ASSETS.magicRules).map((name) => [
      `RULESET_${name}`, magicRuleUrl(name, "surge"),
    ])),
  };
  const template = renderPoolTemplate(groups, smartPriorityScheme, idcNames).replace(/(^\[General\]\n)([\s\S]*?)(?=^\[)/m, (_, heading, body) => {
    let general = body.replace(/^[ \t]*(?:#[ \t]*)?(encrypted-dns-(?:server|follow-outbound-mode)[ \t]*=.+)$/gm, (_, setting) => `${options.doh ? "" : "# "}${setting}`);
    if (options.tencentOa) general = general.replace(/^skip-proxy[ \t]*=[ \t]*(.*)$/m, (_, value) => `skip-proxy = ${appendTencentOaSkipProxy(value)}`);
    return heading + general;
  });
  return applyRuleSetVisibility(replaceTemplate(template, replacements), { showAllGroups });
}

function renderPoolTemplate(groups, smartPriorityScheme, idcNames) {
  const orderedGroups = [...groups].sort(compareNodeGroups);
  const groupNamesByIpType = (order) => [...orderedGroups].sort((a, b) =>
    order[a.nodes[0].ipType] - order[b.nodes[0].ipType]
    || compareNodeGroups(a, b)).map(({ group }) => group).join(", ");
  const section = replaceTemplate(ASSETS.poolGroups, {
    POOL_GROUP_LINES: orderedGroups.map(({ group, nodes }) => {
      const names = nodes.map((node) => node.name);
      return `${group} = smart, ${names.join(", ")}, policy-priority=${JSON.stringify(orderedSmartPriority(names, smartPriorityScheme))}`;
    }).join("\n"),
    // An empty Surge Smart group substitutes DIRECT, so omit it and reject its traffic instead.
    DOH_PROXY_GROUP_LINE: idcNames.length ? `DoH Proxy = smart, ${idcNames.join(", ")}, icon-url=https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Server.png, hidden=true` : "",
    POOL_GROUPS: groupNamesByIpType(IP_TYPE_ORDER),
    IDC_FIRST_POOL_GROUPS: groupNamesByIpType(IDC_FIRST_IP_TYPE_ORDER),
    WARP_FIRST_POOL_GROUPS: groupNamesByIpType(WARP_FIRST_IP_TYPE_ORDER),
  });
  return ASSETS.template.replace(/^\[Proxy Group\]\n[\s\S]*?(?=^\[Rule\]$)/m, () => `${section}\n`);
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
    output = output.replaceAll(`{{${name}}}`, () => value);
  }

  const unresolved = output.match(/{{[A-Za-z0-9_]+}}/g);
  if (unresolved) {
    throw new Error(`Unresolved Surge template placeholders: ${unresolved.join(", ")}`);
  }

  return output.trimEnd() + "\n";
}
