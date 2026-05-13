import { ASSETS } from "./generated/assets.js";
import { HttpError } from "./errors.js";
import { renderProxyLines } from "./nodes.js";

const NODE_GROUP_PATTERN = /{{NODE_GROUP:([^}\r\n]+)}}/g;

export function renderSurgeProfile({ requestUrl, token, nodes }) {
  const template = renderNodeGroups(ASSETS.template, nodes);
  const replacements = {
    MANAGED_CONFIG: `#!MANAGED-CONFIG ${buildUrl(requestUrl, "/surge", token)} interval=86400 strict=false`,
    PROXY_LINES: renderProxyLines(nodes),
    RULE_LINES: ASSETS.rules,
  };

  return replaceTemplate(template, replacements);
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

function renderNodeGroups(template, nodes) {
  const nodeGroups = getTemplateNodeGroups(template);
  const nodesByGroup = new Map(nodeGroups.map((group) => [group, []]));

  for (const node of nodes) {
    const groupNodes = nodesByGroup.get(node.group);
    if (!groupNodes) {
      throw new HttpError(500, `Node ${node.name} references unknown node group: ${node.group}`);
    }
    groupNodes.push(node.name);
  }

  return template.replace(NODE_GROUP_PATTERN, (_placeholder, rawGroup) => {
    const group = rawGroup.trim();
    const groupNodes = nodesByGroup.get(group);
    if (groupNodes.length === 0) {
      throw new HttpError(500, `Node group ${group} has no nodes`);
    }
    return `${group} = url-test, ${groupNodes.join(", ")}, url=http://www.gstatic.com/generate_204, interval=300, tolerance=50`;
  });
}

function getTemplateNodeGroups(template) {
  const nodeGroups = [];
  const seen = new Set();

  for (const match of template.matchAll(NODE_GROUP_PATTERN)) {
    const group = match[1].trim();
    if (!group) {
      throw new HttpError(500, "NODE_GROUP placeholder must include a group name");
    }
    if (group.includes(",")) {
      throw new HttpError(500, `NODE_GROUP cannot contain a comma: ${group}`);
    }
    if (seen.has(group)) {
      throw new HttpError(500, `Duplicate NODE_GROUP placeholder: ${group}`);
    }
    seen.add(group);
    nodeGroups.push(group);
  }

  return nodeGroups;
}
