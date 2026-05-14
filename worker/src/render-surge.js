import { ASSETS } from "./generated/assets.js";
import { HttpError } from "./errors.js";
import { renderProxyLines } from "./nodes.js";
import { SUBSCRIPTION_PATH } from "./routes.js";

const NODE_GROUP_PATTERN = /{{NODE_GROUP:([^}\r\n]+)}}/g;
const FALLBACK_POLICY = "🚀 Proxy";

export function renderSurgeProfile({ requestUrl, token, nodes, mitm = null }) {
  const nodeGroupState = getNodeGroupState(ASSETS.template, nodes);
  const template = renderNodeGroups(ASSETS.template, nodeGroupState);
  const replacements = {
    MANAGED_CONFIG: `#!MANAGED-CONFIG ${buildUrl(requestUrl, SUBSCRIPTION_PATH, token)} interval=86400 strict=false`,
    MITM_LINES: renderMitmLines(mitm),
    MODULE_URL_LINES: renderModuleUrlLines(requestUrl, token),
    PROXY_LINES: renderProxyLines(nodes),
    RULE_LINES: renderRuleLines(ASSETS.rules, nodeGroupState.emptyGroups),
  };

  return replaceTemplate(template, replacements);
}

function renderMitmLines(mitm) {
  if (!mitm || !mitm.enabled) {
    return "";
  }

  const lines = [
    "[MITM]",
    "enable = true",
    `ca-p12 = ${mitm.caP12}`,
    `ca-passphrase = ${mitm.caPassphrase}`,
  ];

  if (mitm.hostname) {
    lines.push(`hostname = ${mitm.hostname}`);
  }

  return lines.join("\n");
}

export function getModule(name) {
  return ASSETS.modules[name] ?? null;
}

function renderModuleUrlLines(requestUrl, token) {
  const moduleEntries = Object.entries(ASSETS.modules).sort(([left], [right]) => left.localeCompare(right));
  if (moduleEntries.length === 0) {
    return "# - None";
  }

  return moduleEntries
    .map(([moduleName, content]) => `# - ${moduleDisplayName(moduleName, content)}: ${buildUrl(requestUrl, `/modules/${moduleName}`, token)}`)
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

function getNodeGroupState(template, nodes) {
  const nodeGroups = getTemplateNodeGroups(template);
  const nodesByGroup = new Map(nodeGroups.map((group) => [group, []]));

  for (const node of nodes) {
    const groupNodes = nodesByGroup.get(node.group);
    if (!groupNodes) {
      throw new HttpError(500, `Node ${node.name} references unknown node group: ${node.group}`);
    }
    groupNodes.push(node.name);
  }

  return {
    nodesByGroup,
    emptyGroups: new Set(nodeGroups.filter((group) => nodesByGroup.get(group).length === 0)),
  };
}

function renderNodeGroups(template, nodeGroupState) {
  const prunedTemplate = removeEmptyNodeGroupReferences(template, nodeGroupState.emptyGroups);

  return prunedTemplate.replace(NODE_GROUP_PATTERN, (_placeholder, rawGroup) => {
    const group = rawGroup.trim();
    const groupNodes = nodeGroupState.nodesByGroup.get(group);
    return groupNodes.join(", ");
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

function removeEmptyNodeGroupReferences(template, emptyGroups) {
  if (emptyGroups.size === 0) {
    return template;
  }

  let section = "";
  return template
    .split("\n")
    .map((line) => {
      const nextSection = line.match(/^\[([^\]]+)\]$/);
      if (nextSection) {
        section = nextSection[1];
        return line;
      }
      if (section !== "Proxy Group") {
        return line;
      }
      if (definesEmptyNodeGroup(line, emptyGroups)) {
        return "";
      }
      return removeCommaSeparatedValues(line, emptyGroups);
    })
    .join("\n");
}

function definesEmptyNodeGroup(line, emptyGroups) {
  const separatorIndex = line.indexOf("=");
  if (separatorIndex === -1) {
    return false;
  }

  const groupName = line.slice(0, separatorIndex).trim();
  return emptyGroups.has(groupName)
    && Array.from(line.matchAll(NODE_GROUP_PATTERN)).some((match) => match[1].trim() === groupName);
}

function renderRuleLines(rules, emptyGroups) {
  if (emptyGroups.size === 0) {
    return rules;
  }

  return rules
    .split("\n")
    .map((line) => replaceRulePolicy(line, emptyGroups))
    .join("\n");
}

function replaceRulePolicy(line, emptyGroups) {
  if (!line.trim() || line.trimStart().startsWith("#")) {
    return line;
  }

  const parts = line.split(",");
  if (parts.length < 3 || !emptyGroups.has(parts[2].trim())) {
    return line;
  }

  parts[2] = FALLBACK_POLICY;
  return parts.map((part) => part.trim()).join(",");
}

function removeCommaSeparatedValues(line, valuesToRemove) {
  const separatorIndex = line.indexOf("=");
  if (separatorIndex === -1) {
    return line;
  }

  const left = line.slice(0, separatorIndex).trimEnd();
  const values = line
    .slice(separatorIndex + 1)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && !valuesToRemove.has(value));

  return `${left} = ${values.join(", ")}`;
}
