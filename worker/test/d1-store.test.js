import assert from "node:assert/strict";
import test from "node:test";
import { createWriteBatch, database } from "../src/d1-store.js";
import { allocateNodes, parsePoolNodes, userGroups } from "../src/node-pool.js";
import { readSubscriptionState, writeSubscriptionState } from "../src/subscription-db.js";
import { callSubscriptionStore } from "../src/subscription-store.js";
import { createD1Env } from "../test-helpers/d1.js";

const NOW = "2026-01-01T00:00:00.000Z";
const user = (index) => ({ id: `user-${index}`, email: `user-${index}@example.com`, subscribeToken: `test-token-${index}`, enabled: true, createdAt: NOW });
const entries = (count = 3) => Array.from({ length: count }, (_, index) => ({
  id: `node-${index}`, line: `🇺🇸 Example - ISP ${index} = trojan, node-${index}.example.com, 443, password=TEST_ONLY`,
}));

test("relational compare-and-swap commits one allocation and leaves no rows from a losing request", async () => {
  const env = createD1Env();
  const copies = await Promise.all([readSubscriptionState(env), readSubscriptionState(env)]);
  for (const [index, stored] of copies.entries()) {
    stored.state.users.push(user(index));
    stored.state.nodes = parsePoolNodes(entries());
    stored.state.revision = 1;
    allocateNodes(stored.state, NOW);
  }
  const writes = await Promise.all([
    writeSubscriptionState(env, copies[0]), writeSubscriptionState(env, copies[1]),
  ]);
  assert.equal(writes.filter(Boolean).length, 1);
  const current = await readSubscriptionState(env);
  assert.equal(current.version, 1);
  assert.deepEqual(current.state, copies[writes[0] ? 0 : 1].state);
  assert.equal(current.rows.assignments.length, 1);

  const stale = createWriteBatch(env, "subscriptions", 0, 99);
  stale.deleteAll("assignments");
  stale.deleteAll("nodes");
  stale.deleteAll("users");
  assert.equal(await stale.commit(), false);
  assert.deepEqual(await readSubscriptionState(env), current);
});

test("a failed multi-table batch rolls back users, counters, assignments and version", async () => {
  const env = createD1Env();
  const before = await readSubscriptionState(env);
  const stored = await readSubscriptionState(env);
  stored.state.users.push(user(0));
  stored.state.nodes = parsePoolNodes(entries());
  stored.state.revision = 1;
  allocateNodes(stored.state, NOW);
  stored.state.nodes[1].ownerIds.push("missing-user");
  await assert.rejects(() => writeSubscriptionState(env, stored), /FOREIGN KEY constraint failed/);
  assert.deepEqual(await readSubscriptionState(env), before);
  stored.state.nodes[1].ownerIds = [];
  assert.equal(await writeSubscriptionState(env, stored), true);
});

test("schema enforces normalized emails, unique tokens, one primary per group and valid node groups", async () => {
  const env = createD1Env();
  await callSubscriptionStore(env, { action: "save-inventory", revision: 0, nodes: entries() });
  const alice = await callSubscriptionStore(env, { action: "account", identity: { email: "alice@example.com" } });
  const bob = await callSubscriptionStore(env, { action: "account", identity: { email: "bob@example.com" } });
  await assert.rejects(() => env.DB.prepare("UPDATE users SET email = ? WHERE id = ?").bind(alice.email, bob.id).run(), /UNIQUE/);
  await assert.rejects(() => env.DB.prepare("UPDATE users SET email = ? WHERE id = ?").bind(" BOB@example.com ", bob.id).run(), /CHECK/);
  await assert.rejects(() => env.DB.prepare("UPDATE users SET subscribe_token = ? WHERE id = ?").bind(alice.subscribeToken, bob.id).run(), /UNIQUE/);
  await assert.rejects(() => env.DB.prepare("UPDATE users SET enabled = 2 WHERE id = ?").bind(alice.id).run(), /CHECK/);
  await assert.rejects(() => env.DB.prepare("INSERT INTO assignments VALUES (?, ?, ?, ?)").bind(alice.id, "🇺🇸USA-ISP", "node-2", 1).run(), /UNIQUE/);
  await assert.rejects(() => env.DB.prepare("INSERT INTO assignments VALUES (?, ?, ?, ?)").bind(alice.id, "🇭🇰HK-ISP", "node-2", 1).run(), /FOREIGN KEY/);
});

test("migration preserves tokens, shared-owner order, counters and manual profiles without a snapshot table", async () => {
  const state = { revision: 7, users: Array.from({ length: 6 }, (_, index) => user(index)), nodes: parsePoolNodes(entries()) };
  allocateNodes(state, NOW);
  const manual = { profiles: [{
    id: "manual", name: "Manual", subscribeToken: "manual-test-token",
    nodes: [
      { group: "US", value: ["ONE = direct", "TWO = reject"] },
      { name: "THREE", group: "HK", value: "direct" },
    ],
    mitm: { enabled: false, caP12: "QUJDRA==", caPassphrase: "TEST_ONLY", caCertificate: "TEST_CERT" },
  }] };
  const env = createD1Env(manual, { version: 1, ...state });
  const stored = await readSubscriptionState(env);
  assert.deepEqual(stored.state, state);
  assert.equal(stored.rows.assignments.length, 6);
  assert.equal((await env.DB.prepare("SELECT count(*) AS count FROM manual_profiles").first()).count, 1, "historical migrations preserve retired data");
  const { results: tables } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  assert.deepEqual(tables.map((row) => row.name).sort(), ["assignments", "magic_rule_sets", "manual_mitm", "manual_nodes", "manual_profiles", "nodes", "store_versions", "users"]);
  for (const person of state.users) {
    const result = await callSubscriptionStore(env, { action: "subscription", token: person.subscribeToken });
    assert.deepEqual(result.groups.map((group) => group.nodes.map((node) => node.id)), userGroups(state, person.id).map((group) => group.nodes.map((node) => node.id)));
  }
});

test("node name swaps, regrouping and owner removal retain relational integrity and history", async () => {
  const env = createD1Env();
  const inventory = entries();
  await callSubscriptionStore(env, { action: "save-inventory", revision: 0, nodes: inventory });
  for (let index = 0; index < 6; index += 1) await callSubscriptionStore(env, { action: "account", identity: { email: user(index).email } });
  const before = await readSubscriptionState(env);
  [inventory[0].line, inventory[1].line] = [inventory[1].line, inventory[0].line];
  await callSubscriptionStore(env, { action: "save-inventory", revision: 1, nodes: inventory });
  let after = await readSubscriptionState(env);
  assert.deepEqual(after.rows.assignments, before.rows.assignments);
  assert.deepEqual(after.state.nodes.map((node) => node.assignmentCount), before.state.nodes.map((node) => node.assignmentCount));
  inventory[2].line = inventory[2].line.replace("🇺🇸", "🇭🇰");
  await callSubscriptionStore(env, { action: "save-inventory", revision: 2, nodes: inventory });
  after = await readSubscriptionState(env);
  assert.equal(after.rows.assignments.length, 12);
  assert.deepEqual(after.state.nodes.map((node) => node.ownerIds.length), [3, 3, 6]);
  await callSubscriptionStore(env, { action: "set-user", id: after.state.users[0].id, enabled: false });
  after = await readSubscriptionState(env);
  assert.equal(after.rows.assignments.length, 10);
  assert.equal(after.rows.assignments.some((row) => row.user_id === after.state.users[0].id), false);
  for (const person of after.state.users.filter((item) => item.enabled)) {
    const result = await callSubscriptionStore(env, { action: "subscription", token: person.subscribeToken });
    assert.deepEqual(result.groups.map((group) => group.nodes.map((node) => node.id)), userGroups(after.state, person.id).map((group) => group.nodes.map((node) => node.id)));
  }
});

test("deleting assigned nodes persists balanced replacements and preserves surviving order and history", async () => {
  const env = createD1Env();
  await callSubscriptionStore(env, { action: "save-inventory", revision: 0, nodes: entries(4) });
  for (let index = 0; index < 6; index += 1) await callSubscriptionStore(env, { action: "account", identity: { email: user(index).email } });
  const before = await readSubscriptionState(env);
  const remaining = entries(4).filter((node) => node.id !== "node-1").reverse();
  const saved = await callSubscriptionStore(env, { action: "save-inventory", revision: 1, nodes: remaining });
  const after = await readSubscriptionState(env);
  assert.equal(saved.revision, 2);
  assert.deepEqual(after.state.nodes, saved.nodes);
  assert.deepEqual(after.state.nodes.map((node) => node.id), ["node-0", "node-2", "node-3"]);
  assert.deepEqual(after.rows.nodes.map((node) => node.sort_order), [0, 1, 2]);
  assert.deepEqual(after.rows.users, before.rows.users, "removal must not change identities or subscription tokens");
  assert.equal(after.rows.assignments.length, 6);
  assert.ok(after.rows.assignments.every((row) => row.node_id !== "node-1"));
  for (const node of after.state.nodes) {
    const old = before.state.nodes.find((candidate) => candidate.id === node.id);
    assert.equal(node.ownerIds.length, 2);
    assert.deepEqual(node.ownerIds.slice(0, old.ownerIds.length), old.ownerIds);
    assert.equal(node.firstAssignedAt, old.firstAssignedAt);
    assert.equal(node.assignmentCount, old.assignmentCount + 2 - old.ownerIds.length);
  }
  for (const person of after.state.users) {
    const result = await callSubscriptionStore(env, { action: "subscription", token: person.subscribeToken });
    const expected = userGroups(after.state, person.id);
    assert.deepEqual(result.groups.map((group) => group.primaryId), expected.map((group) => group.primaryId));
    assert.deepEqual(result.groups.map((group) => group.nodes.map((node) => node.id)), expected.map((group) => group.nodes.map((node) => node.id)));
    assert.deepEqual(new Set(result.groups[0].nodes.map((node) => node.id)), new Set(["node-0", "node-2", "node-3"]));
  }
  await assert.rejects(() => callSubscriptionStore(env, { action: "save-inventory", revision: 1, nodes: entries(4) }), (error) => error.status === 409);
  assert.deepEqual(await readSubscriptionState(env), after, "stale inventory cannot restore the deleted node");
});

test("failed and stale deletions leave nodes, assignments and counters unchanged", async () => {
  const env = createD1Env();
  await callSubscriptionStore(env, { action: "save-inventory", revision: 0, nodes: entries() });
  await callSubscriptionStore(env, { action: "account", identity: { email: user(0).email } });
  const before = await readSubscriptionState(env);
  const stored = await readSubscriptionState(env);
  stored.state.nodes = parsePoolNodes(entries().slice(1), stored.state.nodes);
  stored.state.revision += 1;
  allocateNodes(stored.state, NOW);
  stored.state.nodes[0].ownerIds.push("missing-user");
  await assert.rejects(() => writeSubscriptionState(env, stored), /FOREIGN KEY constraint failed/);
  assert.deepEqual(await readSubscriptionState(env), before);

  stored.state.nodes[0].ownerIds.pop();
  await callSubscriptionStore(env, { action: "account", identity: { email: user(1).email } });
  const current = await readSubscriptionState(env);
  assert.equal(await writeSubscriptionState(env, stored), false);
  assert.deepEqual(await readSubscriptionState(env), current, "a stale deletion cannot remove nodes or a new user's allocation");
});

test("writes are chunked for D1 and token rotation does not rewrite unrelated rows", async () => {
  const env = createD1Env();
  await callSubscriptionStore(env, { action: "save-inventory", revision: 0, nodes: entries(120) });
  const alice = await callSubscriptionStore(env, { action: "account", identity: { email: "alice@example.com" } });
  const before = await readSubscriptionState(env);
  const writes = env.writeCount;
  const rotated = await callSubscriptionStore(env, { action: "rotate-token", identity: { email: alice.email } });
  assert.notEqual(rotated.subscribeToken, alice.subscribeToken);
  assert.equal(env.writeCount - writes, 2, "only one user and the version row change");
  const after = await readSubscriptionState(env);
  assert.deepEqual(after.rows.nodes, before.rows.nodes);
  assert.deepEqual(after.rows.assignments, before.rows.assignments);
});

test("missing D1 binding fails closed without falling back to an old store", async () => {
  const env = { ATLAS_ROUTER: { get() { assert.fail("old KV must not be read"); } } };
  assert.throws(() => database(env), (error) => error.status === 503);
  await assert.rejects(() => readSubscriptionState(env), (error) => error.status === 503);
});
