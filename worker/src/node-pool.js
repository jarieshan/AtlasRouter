import { HttpError } from "./errors.js";
import { parseNodesConfig } from "./nodes.js";
import { splitSurgeList, surgeOptions, surgeValue } from "./surge-format.js";

export function identifyNodeGroup(name) {
  const flags = name.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) ?? [];
  const types = new Set(Array.from(name.toUpperCase().matchAll(/(?:^|[^A-Z0-9])(IDC|ISP|WARP)(?=$|[^A-Z0-9])/g), (match) => match[1]));
  if (flags.length !== 1 || types.size !== 1) {
    throw new HttpError(400, "Each node name must contain one country flag and exactly one of IDC, ISP, WARP");
  }
  const region = Array.from(flags[0], (letter) => String.fromCharCode(letter.codePointAt(0) - 0x1F1E6 + 65)).join("");
  const ipType = [...types][0];
  return { region, ipType, group: `${flags[0]}${region === "US" ? "USA" : region}-${ipType}` };
}

export function parsePoolNodes(entries, previous = []) {
  if (!Array.isArray(entries) || entries.length > 1000) {
    throw new HttpError(400, "nodes must be an array of at most 1000 entries");
  }
  const oldNodes = new Map(previous.map((node) => [node.id, node]));
  const ids = new Set();
  const names = new Set();
  const parsed = entries.map((entry, index) => {
    if (!entry || typeof entry.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.id)
      || typeof entry.line !== "string" || entry.line.length > 4096
      || (entry.enabled !== undefined && typeof entry.enabled !== "boolean")) {
      throw new HttpError(400, `Invalid node at index ${index}: expected id, line and optional boolean enabled`);
    }
    const separator = entry.line.indexOf("=");
    const name = entry.line.slice(0, separator).trim();
    if (separator < 1 || /[\r\n,=\[\]{}]/.test(name) || /^[#;]/.test(name)) {
      throw new HttpError(400, `Invalid node name at index ${index}`);
    }
    const classification = identifyNodeGroup(name);
    let node;
    try {
      [node] = parseNodesConfig([{ line: entry.line, group: classification.group }]);
    } catch {
      throw new HttpError(400, `Invalid Surge node line at index ${index}`);
    }
    if (ids.has(entry.id) || names.has(node.name)) {
      throw new HttpError(400, "Node ids and names must be unique");
    }
    ids.add(entry.id);
    names.add(node.name);
    const old = oldNodes.get(entry.id);
    return {
      ...node,
      ...classification,
      id: entry.id,
      enabled: entry.enabled !== false,
      ownerIds: old?.group === node.group ? [...old.ownerIds] : [],
      assignmentCount: old?.assignmentCount ?? 0,
      firstAssignedAt: old?.firstAssignedAt ?? null,
    };
  });
  if (parsed.some((node) => names.has(node.group))) {
    throw new HttpError(400, "Node names must not collide with policy group names");
  }
  // An editor's row ordering must not silently change every user's fallback order.
  const byId = new Map(parsed.map((node) => [node.id, node]));
  const previousGroups = groupNodeVariants(previous);
  const retained = previousGroups.flatMap((node) => node.members.map((member) => byId.get(member.id))).filter(Boolean);
  const ordered = [...retained, ...parsed.filter((node) => !oldNodes.has(node.id))];
  const replacements = new Map(groupNodeVariants(ordered).flatMap((node) => node.members.map((member) => [member.id, node])));
  for (const previousNode of previousGroups) {
    if (previousNode.members.length < 2) continue;
    const removed = previousNode.members.filter((node) => !byId.has(node.id));
    if (!removed.length) continue;
    const surviving = new Set(previousNode.members.filter((member) => byId.get(member.id)?.group === previousNode.group)
      .map((member) => replacements.get(member.id)));
    if (surviving.size !== 1) continue;
    const [replacement] = surviving;
    const anchor = replacement.anchor;
    anchor.ownerIds = [...new Set([...anchor.ownerIds, ...removed.flatMap((node) => node.ownerIds)])];
    anchor.assignmentCount += removed.reduce((count, node) => count + node.assignmentCount, 0);
    anchor.firstAssignedAt = [anchor.firstAssignedAt, ...removed.map((node) => node.firstAssignedAt)].filter(Boolean).sort()[0] ?? null;
  }
  return ordered;
}

const protocolOrder = ["vless", "vmess", "hysteria2"];

export function groupNodeVariants(nodes) {
  const identities = new Map(nodes.map((node) => [node.id, nodeIdentity(node)]));
  // 3x-ui gives Hy2 a separate password. Match its explicitly tagged client
  // name to a unique VLESS/VMess identity on the same server and in the same group.
  const labels = new Map();
  for (const identity of identities.values()) {
    if (!identity.label) continue;
    if (!labels.has(identity.label)) labels.set(identity.label, []);
    labels.get(identity.label).push(identity);
  }
  for (const matches of labels.values()) {
    const hy2 = matches.filter((item) => item.protocol === "hysteria2");
    const others = matches.filter((item) => item.protocol !== "hysteria2");
    const keys = new Set(others.map((item) => item.key));
    if (hy2.length === 1 && keys.size === 1 && new Set(others.map((item) => item.protocol)).size === others.length) {
      hy2[0].key = others[0].key;
    }
  }
  const candidates = new Map();
  for (const node of nodes) {
    const { key } = identities.get(node.id);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(node);
  }
  const seen = new Set();
  const result = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const identity = identities.get(node.id);
    const candidatesForNode = candidates.get(identity.key);
    const paired = candidatesForNode.length > 1
      && new Set(candidatesForNode.map((member) => identities.get(member.id).protocol)).size === candidatesForNode.length;
    const members = paired ? candidatesForNode : [node];
    for (const member of members) seen.add(member.id);
    const enabled = members.filter((member) => member.enabled);
    result.push({
      key: paired || candidatesForNode.length === 1 ? identity.key : `node:${node.id}`,
      group: node.group,
      members,
      anchor: enabled[0] ?? node,
      variants: [...enabled].sort((a, b) => protocolOrder.indexOf(identities.get(a.id).protocol) - protocolOrder.indexOf(identities.get(b.id).protocol)),
      ownerIds: [...new Set(members.flatMap((member) => member.ownerIds))],
      assignmentCount: members.reduce((count, member) => count + member.assignmentCount, 0),
      firstAssignedAt: members.map((member) => member.firstAssignedAt).filter(Boolean).sort()[0] ?? null,
    });
  }
  return result;
}

function nodeIdentity(node) {
  try {
    const [type, host, , ...parameters] = splitSurgeList(node.value);
    const protocol = type.toLowerCase();
    if (protocolOrder.includes(protocol)) {
      const address = surgeValue(host);
      const authority = address.includes(":") && !address.startsWith("[") ? `[${address}]` : address;
      const server = new URL(`http://${authority}`).hostname.toLowerCase().replace(/\.$/, "");
      const options = surgeOptions(parameters);
      if (protocol === "hysteria2" && options.get("password")) {
        const client = node.name.match(/-Hy2[- ](.+)$/i)?.[1];
        return { protocol, key: `node:${node.id}`, label: client && JSON.stringify([node.group, server, client]) };
      }
      const username = options.get("username");
      if (protocol !== "hysteria2" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(username ?? "")) {
        const client = node.name.match(/-(?:VMess|VLESS)[- ](.+)$/i)?.[1] ?? node.name.match(/[- ]((?:IDC|ISP|WARP)\b.*)$/i)?.[1];
        return { protocol, key: JSON.stringify([node.group, server, username.toLowerCase()]),
          label: client && JSON.stringify([node.group, server, client]) };
      }
    }
  } catch { /* Invalid or unsupported connection formats keep their own allocation. */ }
  return { protocol: null, key: `node:${node.id}` };
}

export function allocateNodes(state, now) {
  const activeUsers = new Set(state.users.filter((user) => user.enabled).map((user) => user.id));
  const logicalNodes = groupNodeVariants(state.nodes);
  const previousCounts = new Map(logicalNodes.map((node) => [node.key, node.assignmentCount]));
  const groups = new Map();
  for (const node of logicalNodes) {
    node.ownerIds = node.variants.length ? node.ownerIds.filter((id) => activeUsers.has(id)) : [];
    if (!node.variants.length) continue;
    if (!groups.has(node.group)) groups.set(node.group, []);
    groups.get(node.group).push(node);
  }
  for (const nodes of groups.values()) {
    const owners = new Set(nodes.flatMap((node) => node.ownerIds));
    // Prefer the fewest current users, then the fewest historical assignments.
    // Sharing is allowed only when all enabled nodes already have an owner.
    const leastLoaded = () => [...nodes].sort((a, b) => a.ownerIds.length - b.ownerIds.length || a.assignmentCount - b.assignmentCount)[0];
    for (const user of state.users) {
      if (!user.enabled || owners.has(user.id)) continue;
      assign(leastLoaded(), user.id, now);
      owners.add(user.id);
    }
    // New capacity or released users can unbalance existing assignments. Move
    // only the excess owners, preserving each node's earliest owner when possible.
    while (true) {
      const least = leastLoaded();
      const most = [...nodes].sort((a, b) => b.ownerIds.length - a.ownerIds.length)[0];
      if (most.ownerIds.length - least.ownerIds.length <= 1) break;
      assign(least, most.ownerIds.pop(), now);
    }
  }
  for (const node of logicalNodes) {
    for (const member of node.members) member.ownerIds = [];
    node.anchor.ownerIds = node.ownerIds;
    node.anchor.assignmentCount += node.assignmentCount - previousCounts.get(node.key);
    node.anchor.firstAssignedAt ??= node.firstAssignedAt;
  }
}

function assign(node, userId, now) {
  node.ownerIds.push(userId);
  node.assignmentCount += 1;
  node.firstAssignedAt ??= now;
}

export function userGroups(state, userId) {
  const groups = new Map();
  for (const node of groupNodeVariants(state.nodes)) {
    if (!node.variants.length) continue;
    if (!groups.has(node.group)) groups.set(node.group, []);
    groups.get(node.group).push(node);
  }
  return [...groups.entries()].map(([group, nodes]) => {
    const index = nodes.findIndex((node) => node.ownerIds.includes(userId));
    if (index < 0) return { group, primaryId: null, nodes: [] };
    const primary = nodes[index];
    const backups = [...nodes.slice(index + 1), ...nodes.slice(0, index)];
    // Spread users sharing a primary across its backups, using persisted owner order.
    const offset = backups.length ? primary.ownerIds.indexOf(userId) % backups.length : 0;
    return {
      group,
      primaryId: primary.variants[0].id,
      nodes: [primary, ...backups.slice(offset), ...backups.slice(0, offset)].flatMap((node) => node.variants),
    };
  });
}

export function accountView(state, user) {
  const groups = userGroups(state, user.id).map(({ group, primaryId, nodes }) => ({
    group, primaryId, nodes: nodes.map(({ id, name }) => ({ id, name })),
  }));
  const allocated = groups.filter((group) => group.primaryId).length;
  return {
    id: user.id,
    email: user.email,
    subscribeToken: user.subscribeToken,
    status: allocated === 0 ? "pending" : allocated === groups.length ? "active" : "partial",
    groups,
  };
}
