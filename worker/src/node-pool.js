import { HttpError } from "./errors.js";
import { parseNodesConfig } from "./nodes.js";

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
  const retained = previous.map((node) => byId.get(node.id)).filter(Boolean);
  return [...retained, ...parsed.filter((node) => !oldNodes.has(node.id))];
}

export function allocateNodes(state, now) {
  const activeUsers = new Set(state.users.filter((user) => user.enabled).map((user) => user.id));
  const groups = new Map();
  for (const node of state.nodes) {
    node.ownerIds = node.enabled ? node.ownerIds.filter((id) => activeUsers.has(id)) : [];
    if (!node.enabled) continue;
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
}

function assign(node, userId, now) {
  node.ownerIds.push(userId);
  node.assignmentCount += 1;
  node.firstAssignedAt ??= now;
}

export function userGroups(state, userId) {
  const groups = new Map();
  for (const node of state.nodes) {
    if (!node.enabled) continue;
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
      primaryId: primary.id,
      nodes: [primary, ...backups.slice(offset), ...backups.slice(0, offset)],
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
