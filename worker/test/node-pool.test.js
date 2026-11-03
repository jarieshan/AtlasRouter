import assert from "node:assert/strict";
import test from "node:test";
import { identifyNodeGroup, parsePoolNodes, allocateNodes, accountView, userGroups } from "../src/node-pool.js";
import { renderAccountPage } from "../src/pool-pages.js";
import { renderSurgeProfile } from "../src/render-surge.js";
import { getAdminRoutes } from "../src/routes.js";

const NOW = "2026-01-01T00:00:00.000Z";
const ICON_BASE = "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/";
function inventory(count = 3, flag = "🇺🇸", type = "ISP") {
  return Array.from({ length: count }, (_, index) => ({
    id: `${type}-${index + 1}`,
    line: `${flag} LosAngeles - ${type} ${index + 1} = trojan, node-${index + 1}.example.com, 443, password=REPLACE_ME`,
  }));
}
function createState(nodeCount = 3, userCount = nodeCount) {
  return {
    nodes: parsePoolNodes(inventory(nodeCount)),
    users: Array.from({ length: userCount }, (_, index) => ({ id: `user-${index}`, enabled: true })),
  };
}

function assertBalancedOrders(state) {
  const users = state.users.filter((user) => user.enabled);
  const groupNames = new Set(state.nodes.filter((node) => node.enabled).map((node) => node.group));
  for (const groupName of groupNames) {
    const nodes = state.nodes.filter((node) => node.enabled && node.group === groupName);
    const orders = users.map((user) => {
      const group = userGroups(state, user.id).find((entry) => entry.group === groupName);
      assert.equal(group.nodes[0].id, group.primaryId);
      assert.ok(nodes.find((node) => node.id === group.primaryId).ownerIds.includes(user.id));
      assert.deepEqual(new Set(group.nodes.map((node) => node.id)), new Set(nodes.map((node) => node.id)));
      assert.equal(group.nodes.length, nodes.length);
      return group.nodes;
    });
    for (let rank = 0; rank < nodes.length; rank += 1) {
      const counts = nodes.map((node) => orders.filter((order) => order[rank].id === node.id).length);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `Unbalanced position ${rank} in ${groupName}`);
    }
    if (nodes.length < 2) continue;
    for (const failed of nodes) {
      const affected = orders.filter((order) => order[0].id === failed.id);
      const selected = affected.map((order) => order.find((node) => node.id !== failed.id).id);
      const counts = nodes.filter((node) => node.id !== failed.id).map((node) => selected.filter((id) => id === node.id).length);
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `Unbalanced takeover of ${failed.id}`);
    }
  }
}

test("infers country flags and exact, case-insensitive exit types", () => {
  assert.deepEqual(identifyNodeGroup("🇺🇸 LosAngeles - ISP 1"), { region: "US", ipType: "ISP", group: "🇺🇸USA-ISP" });
  assert.equal(identifyNodeGroup("🇭🇰 HongKong - IDC 1").group, "🇭🇰HK-IDC");
  assert.equal(identifyNodeGroup("🇸🇬 Singapore - warp 1").group, "🇸🇬SG-WARP");
  assert.equal(identifyNodeGroup("🇯🇵 Tokyo - ISP").group, "🇯🇵JP-ISP");
  for (const name of ["LosAngeles ISP", "🇺🇸 ISP WARP", "🇺🇸 🇭🇰 ISP", "🇺🇸 ISPS", "🇸🇬 Singapore"]) {
    assert.throws(() => identifyNodeGroup(name), /one country flag and exactly one/);
  }
});

test("rejects malformed inventory, duplicates, group collisions and config injection", () => {
  const entry = inventory(1)[0];
  for (const entries of [
    null, [null], [{ ...entry, enabled: "true" }], [entry, entry],
    [entry, { ...entry, id: "different" }],
    [{ ...entry, line: "🇺🇸USA-ISP = trojan, node.example.com, 443" }],
    [{ ...entry, line: entry.line + "\n[Rule]" }],
    [{ ...entry, line: entry.line.replace("LosAngeles", "LA,bad") }],
    [{ ...entry, line: entry.line.replace("LosAngeles", "{{RULE_LINES}}") }],
  ]) assert.throws(() => parsePoolNodes(entries), (error) => error.status === 400);
});

test("allocates distinct primaries with the requested 123 / 231 / 312 fallback orders", () => {
  const state = createState();
  allocateNodes(state, NOW);
  assert.deepEqual(state.nodes.map((node) => node.ownerIds), [["user-0"], ["user-1"], ["user-2"]]);
  assert.deepEqual(state.users.map((user) => userGroups(state, user.id)[0].nodes.map((node) => node.id)), [
    ["ISP-1", "ISP-2", "ISP-3"], ["ISP-2", "ISP-3", "ISP-1"], ["ISP-3", "ISP-1", "ISP-2"],
  ]);
  assert.ok(state.nodes.every((node) => node.assignmentCount === 1 && node.firstAssignedAt === NOW));
});

test("shared primaries have distinct deterministic backup orders without changing allocations", () => {
  const state = createState(3, 6);
  allocateNodes(state, NOW);
  const before = structuredClone(state);
  const orders = state.users.map((user) => userGroups(state, user.id)[0].nodes.map((node) => node.id));
  assert.deepEqual(orders, [
    ["ISP-1", "ISP-2", "ISP-3"], ["ISP-2", "ISP-3", "ISP-1"], ["ISP-3", "ISP-1", "ISP-2"],
    ["ISP-1", "ISP-3", "ISP-2"], ["ISP-2", "ISP-1", "ISP-3"], ["ISP-3", "ISP-2", "ISP-1"],
  ]);
  assert.deepEqual(state.users.map((user) => userGroups(state, user.id)[0].nodes.map((node) => node.id)), orders);
  assert.deepEqual(state, before);
});

test("every fallback position and single-node takeover are balanced across complete and partial cycles", () => {
  for (let count = 2; count <= 12; count += 1) {
    for (let users = 1; users <= count * Math.max(3, 2 * (count - 1)); users += 1) {
      const state = createState(count, users);
      allocateNodes(state, NOW);
      assertBalancedOrders(state);
    }
  }
});

test("fallbacks stay balanced after users leave, return and nodes change", () => {
  const state = createState(4, 17);
  state.nodes.push(...parsePoolNodes(inventory(1, "🇭🇰", "IDC")));
  allocateNodes(state, NOW);
  assertBalancedOrders(state);
  for (const index of [0, 5, 9]) state.users[index].enabled = false;
  allocateNodes(state, NOW);
  assertBalancedOrders(state);
  state.users[5].enabled = true;
  state.users.push({ id: "returning-user", enabled: true });
  allocateNodes(state, NOW);
  assertBalancedOrders(state);
  state.nodes[1].enabled = false;
  allocateNodes(state, NOW);
  assertBalancedOrders(state);
  state.nodes = parsePoolNodes([
    ...inventory(5).map((node) => ({ ...node, enabled: node.id !== "ISP-2" })),
    ...inventory(1, "🇭🇰", "IDC"),
  ], state.nodes);
  allocateNodes(state, NOW);
  assertBalancedOrders(state);
  const before = state.users.map((user) => accountView(state, user));
  state.nodes = parsePoolNodes([
    ...inventory(5).map((node) => ({ ...node, enabled: node.id !== "ISP-2" })),
    ...inventory(1, "🇭🇰", "IDC"),
  ].reverse(), state.nodes);
  allocateNodes(state, NOW);
  assert.deepEqual(state.users.map((user) => accountView(state, user)), before);
});

test("singleton and unassigned groups do not invent fallback nodes", () => {
  const state = createState(1, 3);
  allocateNodes(state, NOW);
  assertBalancedOrders(state);
  for (const user of state.users) assert.deepEqual(userGroups(state, user.id)[0].nodes.map((node) => node.id), ["ISP-1"]);
  assert.deepEqual(userGroups(state, "unassigned"), [{ group: "🇺🇸USA-ISP", primaryId: null, nodes: [] }]);
  state.nodes[0].enabled = false;
  allocateNodes(state, NOW);
  assert.deepEqual(userGroups(state, "user-0"), []);
});

test("stable ids preserve ownership and ring order across edits and reordered imports", () => {
  const state = createState(3, 2);
  allocateNodes(state, NOW);
  state.nodes = parsePoolNodes(inventory().reverse().map((entry) => ({ ...entry, line: entry.line.replace("REPLACE_ME", "CHANGED") })), state.nodes);
  allocateNodes(state, NOW);
  assert.deepEqual(state.nodes.map((node) => node.id), ["ISP-1", "ISP-2", "ISP-3"]);
  assert.deepEqual(state.nodes.map((node) => node.ownerIds), [["user-0"], ["user-1"], []]);
  assert.deepEqual(state.nodes.map((node) => node.assignmentCount), [1, 1, 0]);
  assert.deepEqual(parsePoolNodes([], state.nodes), []);
});

test("capacity shortages share nodes and added capacity reduces sharing", () => {
  const state = createState(2, 3);
  allocateNodes(state, NOW);
  assert.equal(accountView(state, state.users[2]).status, "active");
  assert.deepEqual(state.nodes[0].ownerIds, ["user-0", "user-2"]);
  state.nodes = parsePoolNodes(inventory(3), state.nodes);
  allocateNodes(state, NOW);
  assert.deepEqual(state.nodes[2].ownerIds, ["user-2"]);
  assert.deepEqual(state.nodes[0].ownerIds, ["user-0"]);
  assert.equal(accountView(state, state.users[2]).status, "active");
});

test("allocates one primary per group and shares only within that group", () => {
  const state = createState(3, 3);
  state.nodes.push(...parsePoolNodes(inventory(1, "🇭🇰", "IDC")));
  allocateNodes(state, NOW);
  assert.equal(accountView(state, state.users[0]).status, "active");
  assert.equal(accountView(state, state.users[1]).status, "active");
  assert.deepEqual(state.nodes.at(-1).ownerIds, ["user-0", "user-1", "user-2"]);
  assert.equal(userGroups(state, "user-0").filter((group) => group.primaryId).length, 2);
  const view = JSON.stringify(accountView(state, state.users[0]));
  assert.doesNotMatch(view, /REPLACE_ME|example\.com|ownerId|assignmentCount/);
});

test("disabling nodes excludes them from all fallbacks and reassigns to unused capacity first", () => {
  const state = createState(4, 2);
  allocateNodes(state, NOW);
  state.nodes[0].enabled = false;
  allocateNodes(state, NOW);
  assert.deepEqual(state.nodes[0].ownerIds, []);
  assert.deepEqual(state.nodes[2].ownerIds, ["user-0"]);
  assert.ok(userGroups(state, "user-1")[0].nodes.every((node) => node.id !== "ISP-1"));
  state.users[1].enabled = false;
  allocateNodes(state, NOW);
  state.users.push({ id: "user-2", enabled: true });
  allocateNodes(state, NOW);
  assert.deepEqual(state.nodes[3].ownerIds, ["user-2"]);
  assert.deepEqual(state.nodes[1].ownerIds, []);
  assert.equal(state.nodes[1].assignmentCount, 1);
});

test("renders ordered smart groups with valid references and literal credential characters", () => {
  const state = createState();
  state.nodes = parsePoolNodes(inventory().map((entry) => ({ ...entry, line: entry.line.replace("REPLACE_ME", () => "$&$1$$") })));
  allocateNodes(state, NOW);
  const groups = userGroups(state, "user-1");
  const config = renderSurgeProfile({ requestUrl: "https://atlas.example/AtlasRouter", token: "test-token", groups, nodes: groups.flatMap((group) => group.nodes) });
  assert.match(config, /^🇺🇸USA-ISP = smart, 🇺🇸 LosAngeles - ISP 2, 🇺🇸 LosAngeles - ISP 3, 🇺🇸 LosAngeles - ISP 1, policy-priority=/m);
  assert.match(config, /password=\$&\$1\$\$/);
  assert.match(config, /DOMAIN-SUFFIX,kaggle.com,🇺🇸USA-ISP/);
  assert.match(config, /^FINAL,Proxy,dns-failed$/m);
  assert.match(config, /\/AtlasRouter\/modules\/tencent-oa.sgmodule\?token=/);
  assert.doesNotMatch(config, /{{|💎 Select/);
  assert.ok(config.split("\n").includes(`Auto = smart, include-all-proxies=true, icon-url=${ICON_BASE}Auto.png`));
  assert.match(config, /\[MITM\]\nenable = false/);
  assert.doesNotMatch(config, /ca-p12|ca-passphrase/);
  const policyNames = new Set(["DIRECT", "REJECT"]);
  for (const name of config.matchAll(/^(.+?) = /gm)) policyNames.add(name[1]);
  const section = config.split("[Proxy Group]\n")[1].split("[Rule]")[0];
  for (const line of section.split("\n").filter((line) => line.includes(" = "))) {
    for (const member of line.split(" = ")[1].split(",").slice(1).map((value) => value.trim())) {
      if (!member.includes("=")) assert.ok(policyNames.has(member), `Missing policy: ${member}`);
    }
  }
});

test("orders selection options by IP type while preserving regional definitions and per-user fallback order", () => {
  const regions = [["DE", "🇩🇪"], ["JP", "🇯🇵"], ["HK", "🇭🇰"], ["AU", "🇦🇺"], ["US", "🇺🇸"], ["SG", "🇸🇬"]];
  const entries = regions.flatMap(([region, flag]) => ["IDC", "WARP", "ISP"].map((type) => ({
    id: `${region}-${type}`,
    line: `${flag} Example ${region} - ${type} = trojan, ${region.toLowerCase()}-${type.toLowerCase()}.example.com, 443, password=TEST_ONLY`,
  })));
  entries.push({ id: "US-ISP-2", line: "🇺🇸 Example US - ISP 2 = trojan, us-isp-2.example.com, 443, password=TEST_ONLY" });
  const expectedRegions = ["🇺🇸USA", "🇭🇰HK", "🇸🇬SG", "🇯🇵JP", "🇦🇺AU", "🇩🇪DE"];
  for (const hasUsIsp of [true, false]) {
    const selected = hasUsIsp ? entries : entries.filter(({ id }) => !id.startsWith("US-ISP"));
    const state = { nodes: parsePoolNodes(selected), users: [{ id: "other", enabled: true }, { id: "user", enabled: true }] };
    allocateNodes(state, NOW);
    const groups = userGroups(state, "user");
    const before = structuredClone(groups);
    const nodes = groups.flatMap((group) => group.nodes);
    const nodeIds = nodes.map((node) => node.id);
    const config = renderSurgeProfile({ requestUrl: "https://atlas.example/AtlasRouter", token: "test-token", groups, nodes });
    const proxyLines = config.split("[Proxy]\n")[1].split("[Proxy Group]")[0].trim().split("\n");
    const expectedProxyLines = ["US", "HK", "SG", "JP", "AU", "DE"]
      .flatMap((region) => ["ISP", "WARP", "IDC"].flatMap((type) =>
        nodes.filter((node) => node.region === region && node.ipType === type).map((node) => node.line)));
    assert.deepEqual(proxyLines, expectedProxyLines);
    assert.deepEqual(nodes.map((node) => node.id), nodeIds);
    const expectedGroups = expectedRegions.flatMap((region) => ["ISP", "WARP", "IDC"].map((type) => `${region}-${type}`))
      .filter((group) => hasUsIsp || group !== "🇺🇸USA-ISP");
    const expectedOptions = ["ISP", "WARP", "IDC"].flatMap((type) => expectedGroups.filter((group) => group.endsWith(`-${type}`)));
    for (const name of ["Proxy", "AIProxy", "GlobalMedia", "X"]) {
      const line = config.split("\n").find((line) => line.startsWith(`${name} = select, `));
      assert.ok(line);
      const members = line.slice(`${name} = select, `.length).split(", ").filter((value) => !value.includes("="));
      assert.deepEqual(members, [...expectedOptions, name === "Proxy" ? "Auto" : "Proxy", "DIRECT"]);
      assert.equal(new Set(members).size, members.length);
    }
    const icloud = config.split("\n").find((line) => line.startsWith("iCloud = select, "));
    const expectedIcloud = ["IDC", "WARP", "ISP"].flatMap((type) => expectedGroups.filter((group) => group.endsWith(`-${type}`)));
    assert.equal(icloud, `iCloud = select, DIRECT, ${expectedIcloud.join(", ")}, icon-url=${ICON_BASE}iCloud.png`);
    assert.ok(config.split("\n").includes(`WeChat = select, DIRECT, ${expectedIcloud.join(", ")}, icon-url=${ICON_BASE}WeChat.png`));
    assert.ok(config.split("\n").includes("RULE-SET,https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Surge/WeChat/WeChat.list,WeChat,no-resolve,update-interval=86400"));
    const telegram = config.split("\n").find((line) => line.startsWith("Telegram = select, "));
    assert.equal(telegram, `Telegram = select, ${expectedIcloud.join(", ")}, Proxy, DIRECT, icon-url=${ICON_BASE}Telegram.png`);
    const expectedYoutube = ["WARP", "IDC", "ISP"].flatMap((type) => expectedGroups.filter((group) => group.endsWith(`-${type}`)));
    assert.ok(config.split("\n").includes(`YouTube = select, ${expectedYoutube.join(", ")}, icon-url=${ICON_BASE}YouTube.png`));
    const youtubeRule = "/YouTube.list?token=test-token,YouTube,no-resolve,update-interval=86400";
    assert.ok(config.includes(youtubeRule));
    assert.ok(config.indexOf(youtubeRule) < config.indexOf("/GlobalMedia.list?token=test-token,"));
    assert.doesNotMatch(config, /\/Google\.list\?/);
    assert.doesNotMatch(config, /^.+ = select,(?:[^\n]*,)?\s*REJECT(?:,|$)/m);
    assert.doesNotMatch(config, /^AppleProxy = /m);
    assert.ok(config.split("\n").includes(`AppleDirect = select, DIRECT, icon-url=${ICON_BASE}Apple.png, hidden=true`));
    const appleRules = config.split("[Rule]\n")[1].split("\n").filter((line) => /\/(?:AppleTV|AppleIntelligence|iCloud|AppleDirect|Apple)\.list\?/.test(line));
    assert.deepEqual(appleRules.map((line) => [line.match(/\/(\w+)\.list\?/)[1], line.split(",")[2]]), [
      ["AppleTV", "GlobalMedia"], ["AppleIntelligence", "AIProxy"], ["iCloud", "iCloud"], ["AppleDirect", "AppleDirect"], ["Apple", "AppleDirect"],
    ]);
    assert.doesNotMatch(config.split("[Rule]\n")[1], /^RULE-SET,.*hidden=/m);
    const definitions = [...config.matchAll(/^(.+) = smart, .+, policy-priority=/gm)].map((match) => match[1]);
    assert.deepEqual(definitions, expectedGroups);
    assert.ok(config.split("\n").filter((line) => line.includes("policy-priority=")).every((line) => !line.includes(", hidden=")));
    assert.deepEqual(groups, before);
    for (const group of groups) assert.ok(config.includes(`${group.group} = smart, ${group.nodes.map((node) => node.name).join(", ")}, policy-priority=`));
    assert.match(config, /^FINAL,Proxy,dns-failed$/m);
  }
});

test("rendered portal scripts are valid and combined panels have unique element ids", () => {
  const adminRoutes = getAdminRoutes({ ADMIN_API_SLUG: "0123456789abcdef0123456789abcdef" });
  for (const page of [renderAccountPage(), renderAccountPage({ isAdmin: true, adminRoutes })]) {
    for (const [, script] of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(script));
    const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length);
  }
});
