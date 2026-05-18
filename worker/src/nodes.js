import { HttpError } from "./errors.js";

export function parseNodesConfig(value) {
  const entries = expandNodesConfig(value);
  if (entries.length === 0) {
    throw new HttpError(500, "router-config nodes must contain at least one node");
  }

  const nodeNames = new Set();

  return entries.map((node, index) => parseNodeConfig(node, index, nodeNames));
}

export function serializeNodesConfig(nodes) {
  const groups = [];
  const byName = new Map();
  for (const node of nodes) {
    let group = byName.get(node.group);
    if (!group) {
      group = { group: node.group, value: [] };
      byName.set(node.group, group);
      groups.push(group);
    }
    group.value.push(node.line);
  }

  return groups.length === 1 ? groups[0] : groups;
}

export function renderProxyLines(nodes) {
  return nodes.map((node) => node.line).join("\n");
}

function parseNodeConfig(node, index, nodeNames) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new HttpError(500, `Node at index ${index} must be an object`);
  }

  const parsed = parseNodeLine(node, index);
  const { name, value, line } = parsed;
  const group = requiredString(node.group, `Node ${name} must include group`);

  assertSingleLine(name, `Node ${name} name must be a single line`);
  assertSingleLine(group, `Node ${name} group must be a single line`);
  assertSingleLine(value, `Node ${name} value must be a single line`);
  assertSingleLine(line, `Node ${name} line must be a single line`);
  if (name.includes(",")) {
    throw new HttpError(500, "Node name cannot contain a comma");
  }
  if (group.includes(",")) {
    throw new HttpError(500, "Node group cannot contain a comma");
  }
  if (nodeNames.has(name)) {
    throw new HttpError(500, `Duplicate node name: ${name}`);
  }
  nodeNames.add(name);

  return {
    name,
    group,
    value,
    line,
  };
}

function expandNodesConfig(value) {
  if (Array.isArray(value)) {
    return value.flatMap((node, index) => expandNodeEntry(node, index));
  }
  if (!value || typeof value !== "object") {
    throw new HttpError(500, "router-config nodes must be a node group object or JSON array");
  }
  return expandNodeEntry(value, 0);
}

function expandNodeEntry(node, index) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new HttpError(500, `Node at index ${index} must be an object`);
  }
  if (!Array.isArray(node.value)) {
    return [node];
  }
  if (node.name != null || node.line != null) {
    throw new HttpError(500, `Node group at index ${index} must use value array without name or line`);
  }
  if (node.value.length === 0) {
    throw new HttpError(500, `Node group at index ${index} must contain at least one node`);
  }

  const group = requiredString(node.group, `Node group at index ${index} must include group`);
  return node.value.map((line) => ({ group, line }));
}

function parseNodeLine(node, index) {
  if (node.line != null) {
    if (node.name != null || node.value != null) {
      throw new HttpError(500, `Node at index ${index} must use either line or name/value`);
    }
    const line = requiredString(node.line, `Node at index ${index} must include line`);
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      throw new HttpError(500, `Node at index ${index} line must use "name = value"`);
    }
    const name = requiredString(line.slice(0, separatorIndex), `Node at index ${index} line must include name`);
    const value = requiredString(line.slice(separatorIndex + 1), `Node ${name} line must include value`);
    return {
      name,
      value,
      line: `${name} = ${value}`,
    };
  }

  const name = requiredString(node.name, `Node at index ${index} must include name`);
  const value = requiredString(node.value, `Node ${name} must include value`);
  return {
    name,
    value,
    line: `${name} = ${value}`,
  };
}

function requiredString(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(500, message);
  }
  return value.trim();
}

function assertSingleLine(value, message) {
  if (/[\r\n]/.test(value)) {
    throw new HttpError(500, message);
  }
}
