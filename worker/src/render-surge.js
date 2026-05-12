import { ASSETS } from "./generated/assets.js";
import { renderProxyLines } from "./nodes.js";

const REGION_GROUPS = [
  {
    name: "🇭🇰 Airport_HK",
    filter: "(港|HK|Hong Kong|HongKong|hongkong)",
    matcher: /(港|HK|Hong Kong|HongKong|hongkong)/i,
  },
  {
    name: "🇺🇸 Airport_US",
    filter: "(美|US|United States|America|洛杉矶|圣何塞|西雅图|芝加哥|纽约)",
    matcher: /(美|US|United States|America|洛杉矶|圣何塞|西雅图|芝加哥|纽约)/i,
  },
  {
    name: "🇯🇵 Airport_JP",
    filter: "(日|JP|Japan|东京|大阪)",
    matcher: /(日|JP|Japan|东京|大阪)/i,
  },
  {
    name: "🇸🇬 Airport_SG",
    filter: "(新加坡|坡|狮城|SG|Singapore)",
    matcher: /(新加坡|坡|狮城|SG|Singapore)/i,
  },
];

export function renderSurgeProfile({ requestUrl, token, nodes }) {
  const activeRegionGroups = getActiveRegionGroups(nodes);
  const replacements = {
    MANAGED_CONFIG: `#!MANAGED-CONFIG ${buildUrl(requestUrl, "/surge", token)} interval=86400 strict=false`,
    PROXY_LINES: renderProxyLines(nodes),
    PROXY_GROUP_LINES: renderProxyGroupLines(activeRegionGroups),
    RULE_LINES: ASSETS.rules,
    POLICY_US: hasRegion(activeRegionGroups, "🇺🇸 Airport_US") ? "🇺🇸 Airport_US" : "♻️ Auto",
    POLICY_JP: hasRegion(activeRegionGroups, "🇯🇵 Airport_JP") ? "🇯🇵 Airport_JP" : "♻️ Auto",
  };

  return replaceTemplate(ASSETS.template, replacements);
}

export function getModule(name) {
  return ASSETS.modules[name] ?? null;
}

function buildUrl(requestUrl, pathname, token) {
  const url = new URL(requestUrl);
  url.pathname = pathname;
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}

function replaceTemplate(template, replacements) {
  let output = template;
  for (const [name, value] of Object.entries(replacements)) {
    output = output.replaceAll(`{{${name}}}`, value);
  }

  const unresolved = output.match(/{{[A-Z0-9_]+}}/g);
  if (unresolved) {
    throw new Error(`Unresolved Surge template placeholders: ${unresolved.join(", ")}`);
  }

  return output.trimEnd() + "\n";
}

function getActiveRegionGroups(nodes) {
  return REGION_GROUPS.filter((group) =>
    nodes.some((node) => group.matcher.test(node.name)),
  );
}

function hasRegion(activeRegionGroups, name) {
  return activeRegionGroups.some((group) => group.name === name);
}

function renderProxyGroupLines(activeRegionGroups) {
  const regionNames = activeRegionGroups.map((group) => group.name);

  const selectItems = ["DIRECT", "♻️ Auto", "🤖 AIProxy", "🎥 GlobalMedia", ...regionNames];
  const aiItems = [
    ...regionNames.filter((name) => name === "🇺🇸 Airport_US" || name === "🇯🇵 Airport_JP"),
    "♻️ Auto",
  ];
  const mediaItems = [
    ...regionNames.filter((name) =>
      ["🇸🇬 Airport_SG", "🇺🇸 Airport_US", "🇯🇵 Airport_JP"].includes(name),
    ),
    "♻️ Auto",
  ];

  return [
    `🚀 Select = select, ${selectItems.join(", ")}`,
    `🤖 AIProxy = fallback, ${aiItems.join(", ")}, url=http://www.gstatic.com/generate_204, interval=300, timeout=5`,
    `🎥 GlobalMedia = select, ${mediaItems.join(", ")}`,
    ...activeRegionGroups.map((group) =>
      `${group.name} = url-test, include-all-proxies=true, policy-regex-filter=${group.filter}, url=http://www.gstatic.com/generate_204, interval=300, tolerance=50`,
    ),
  ].join("\n");
}
