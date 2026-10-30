import { createWriteBatch, database } from "./d1-store.js";

const USER_COLUMNS = ["id", "email", "subscribe_token", "enabled", "created_at", "sort_order"];
const NODE_COLUMNS = ["id", "name", "group_name", "region", "ip_type", "value", "enabled", "assignment_count", "first_assigned_at", "sort_order"];
const ASSIGNMENT_COLUMNS = ["user_id", "group_name", "node_id", "owner_order"];

export async function readSubscriptionState(env) {
  const db = database(env);
  const [meta, users, nodes, assignments] = await db.batch([
    db.prepare("SELECT version, inventory_revision FROM store_versions WHERE scope = 'subscriptions'"),
    db.prepare("SELECT * FROM users ORDER BY sort_order"),
    db.prepare("SELECT * FROM nodes ORDER BY sort_order"),
    db.prepare("SELECT * FROM assignments ORDER BY node_id, owner_order"),
  ]);
  const rows = { users: users.results, nodes: nodes.results, assignments: assignments.results };
  return {
    version: meta.results[0].version, rows,
    state: stateFromRows(rows, meta.results[0].inventory_revision),
  };
}

// Normal account/subscription reads use the unique email/token index and never
// load other users' credentials. Co-owner order is needed for fallback rotation.
export async function readUserState(env, column, value) {
  const db = database(env);
  const [users, nodes, assignments] = await db.batch([
    db.prepare(`SELECT * FROM users WHERE ${column} = ?`).bind(value),
    db.prepare(`SELECT * FROM nodes WHERE enabled = 1
      AND EXISTS (SELECT 1 FROM users WHERE ${column} = ? AND enabled = 1) ORDER BY sort_order`).bind(value),
    db.prepare(`SELECT a.* FROM assignments a
      JOIN assignments own ON own.node_id = a.node_id
      JOIN users u ON u.id = own.user_id
      WHERE u.${column} = ? AND u.enabled = 1 ORDER BY a.node_id, a.owner_order`).bind(value),
  ]);
  return stateFromRows({ users: users.results, nodes: nodes.results, assignments: assignments.results });
}

export async function readPreviewNodes(env) {
  const { results } = await database(env).prepare(
    "SELECT id, name, group_name FROM nodes WHERE enabled = 1 ORDER BY sort_order",
  ).all();
  return results.map(({ id, name, group_name }) => ({ id, name, group: group_name }));
}

function stateFromRows(rows, revision = 0) {
  const nodes = rows.nodes.map((row) => ({
    id: row.id, name: row.name, group: row.group_name, region: row.region, ipType: row.ip_type,
    value: row.value, line: `${row.name} = ${row.value}`, enabled: row.enabled === 1,
    assignmentCount: row.assignment_count, firstAssignedAt: row.first_assigned_at, ownerIds: [],
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const row of rows.assignments) byId.get(row.node_id)?.ownerIds.push(row.user_id);
  return {
    revision, nodes,
    users: rows.users.map((row) => ({
      id: row.id, email: row.email, subscribeToken: row.subscribe_token,
      enabled: row.enabled === 1, createdAt: row.created_at,
    })),
  };
}

export async function writeSubscriptionState(env, stored) {
  const { state, rows: before, version } = stored;
  const after = {
    users: state.users.map((user, index) => ({
      id: user.id, email: user.email, subscribe_token: user.subscribeToken,
      enabled: Number(user.enabled), created_at: user.createdAt, sort_order: index,
    })),
    nodes: state.nodes.map((node, index) => ({
      id: node.id, name: node.name, group_name: node.group, region: node.region, ip_type: node.ipType,
      value: node.value, enabled: Number(node.enabled), assignment_count: node.assignmentCount,
      first_assigned_at: node.firstAssignedAt, sort_order: index,
    })),
    assignments: state.nodes.flatMap((node) => node.ownerIds.map((id, index) => ({
      user_id: id, group_name: node.group, node_id: node.id, owner_order: index,
    }))),
  };
  const batch = createWriteBatch(env, "subscriptions", version, state.revision);
  const oldNodes = new Map(before.nodes.map((row) => [row.id, row]));
  const newNodeIds = new Set(after.nodes.map((row) => row.id));
  const removedNodes = before.nodes.filter((row) => !newNodeIds.has(row.id));
  // Remove deleted/renamed/regrouped rows first so name swaps work with UNIQUE/FK
  // constraints. Reinsert their assignments after the nodes, within this batch.
  const replacedNodes = after.nodes.filter((row) => {
    const old = oldNodes.get(row.id);
    return old && (old.name !== row.name || old.group_name !== row.group_name);
  });
  const replacedIds = new Set(replacedNodes.map((row) => row.id));
  const assignmentKey = (row) => `${row.user_id}\0${row.group_name}`;
  const oldAssignments = new Map(before.assignments.map((row) => [assignmentKey(row), row]));
  const newAssignments = new Map(after.assignments.map((row) => [assignmentKey(row), row]));
  batch.deleteRows("assignments", ["user_id", "group_name"], before.assignments.filter((row) => !equalRow(row, newAssignments.get(assignmentKey(row)))));
  batch.deleteRows("nodes", ["id"], [...removedNodes, ...replacedNodes]);
  batch.putRows("users", USER_COLUMNS, ["id"], changedRows(before.users, after.users));
  batch.putRows("nodes", NODE_COLUMNS, ["id"], changedRows(before.nodes, after.nodes));
  batch.putRows("assignments", ASSIGNMENT_COLUMNS, ["user_id", "group_name"], after.assignments.filter((row) =>
    replacedIds.has(row.node_id) || !equalRow(row, oldAssignments.get(assignmentKey(row)))));
  return batch.commit();
}

function changedRows(before, after) {
  const byId = new Map(before.map((row) => [row.id, row]));
  return after.filter((row) => !equalRow(row, byId.get(row.id)));
}

function equalRow(a, b) {
  return b !== undefined && Object.keys(a).every((key) => a[key] === b[key]);
}
