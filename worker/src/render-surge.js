import { ASSETS } from "./generated/assets.js";
import { renderProxyLines } from "./nodes.js";
import { POOL_SUBSCRIPTION_PATH } from "./routes.js";
import { buildSubscriptionUrl } from "./subscription-options.js";
import { magicRuleUrl } from "./magic-rules.js";
import { appendTencentOaSkipProxy } from "./tencent-oa.js";
import { applyRuleSetVisibility } from "./rule-visibility.js";
import { orderedSmartPriority } from "./surge-format.js";

const FALLBACK_POLICY = "Proxy";
const REGION_ORDER = { US: 0, HK: 1, SG: 2, JP: 3 };
const IP_TYPE_ORDER = { ISP: 0, WARP: 1, IDC: 2 };
const IDC_FIRST_IP_TYPE_ORDER = { IDC: 0, WARP: 1, ISP: 2 };
const WARP_FIRST_IP_TYPE_ORDER = { WARP: 0, IDC: 1, ISP: 2 };

export function renderSurgeProfile({ requestUrl, token, nodes, groups, options = {}, smartPriorityScheme }) {
  const replacements = {
    MANAGED_CONFIG: `#!MANAGED-CONFIG ${buildSubscriptionUrl(requestUrl, token, options)} interval=86400 strict=false`,
    MITM_LINES: "enable = false",
    MODULE_URL_LINES: renderModuleUrlLines(requestUrl, token, `${POOL_SUBSCRIPTION_PATH}/modules`),
    PROXY_LINES: renderProxyLines([...nodes].sort(compareNodes)),
    RULE_LINES: renderPoolRules(ASSETS.rules, groups),
    ...Object.fromEntries(Object.keys(ASSETS.magicRules).map((name) => [
      `RULESET_${name}`, magicRuleUrl(name, "surge", requestUrl, token),
    ])),
  };
  const template = renderPoolTemplate(groups, smartPriorityScheme).replace(/(^\[General\]\n)([\s\S]*?)(?=^\[)/m, (_, heading, body) => {
    let general = body.replace(/^[ \t]*(?:#[ \t]*)?(encrypted-dns-(?:server|follow-outbound-mode)[ \t]*=.+)$/gm, (_, setting) => `${options.doh ? "" : "# "}${setting}`);
    if (options.tencentOa) general = general.replace(/^skip-proxy[ \t]*=[ \t]*(.*)$/m, (_, value) => `skip-proxy = ${appendTencentOaSkipProxy(value)}`);
    return heading + general;
  });
  return applyRuleSetVisibility(replaceTemplate(template, replacements));
}

function renderPoolTemplate(groups, smartPriorityScheme) {
  const orderedGroups = [...groups].sort(compareNodeGroups);
  const groupNamesByIpType = (order) => [...orderedGroups].sort((a, b) =>
    order[a.nodes[0].ipType] - order[b.nodes[0].ipType]
    || compareNodeGroups(a, b)).map(({ group }) => group).join(", ");
  const section = replaceTemplate(ASSETS.poolGroups, {
    POOL_GROUP_LINES: orderedGroups.map(({ group, nodes }) => {
      const names = nodes.map((node) => node.name);
      return `${group} = smart, ${names.join(", ")}, policy-priority=${JSON.stringify(orderedSmartPriority(names, smartPriorityScheme))}, hidden=true`;
    }).join("\n"),
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

function renderPoolRules(rules, groups) {
  const aliases = new Map([
    ["🇺🇸 US", groups.find(({ nodes }) => nodes[0].region === "US")?.group ?? FALLBACK_POLICY],
    ["🇯🇵 JP", groups.find(({ nodes }) => nodes[0].region === "JP")?.group ?? FALLBACK_POLICY],
    ["🇺🇸🏠 US ISP", groups.find(({ nodes }) => nodes[0].region === "US" && nodes[0].ipType === "ISP")?.group ?? FALLBACK_POLICY],
  ]);
  return rules.split("\n").map((line) => {
    if (line.trimStart().startsWith("#")) return line;
    const parts = line.split(",");
    const policy = aliases.get(parts[2]?.trim());
    if (policy) parts[2] = policy;
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
  return url.toString();
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
