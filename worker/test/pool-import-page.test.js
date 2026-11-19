import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { renderAccountPage } from "../src/pool-pages.js";
import { getAdminRoutes } from "../src/routes.js";

function element(tagName) {
  return {
    tagName, value: "", disabled: false, readOnly: false, children: [], textContent: "",
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}

async function portal(respond, {
  initialState = { nodes: [], users: [], revision: 3 }, confirm = () => true, prompt = () => assert.fail("unexpected prompt"),
} = {}) {
  const routes = getAdminRoutes({ ADMIN_API_SLUG: "0123456789abcdef0123456789abcdef" });
  const fields = new Map([".status", "#inventory", "#import", "#import-notes", "#save", "#append", "#replace", "#pool-reload", "#nodes", "#users", "#counts", "#node-search", "#node-status", "#node-summary", "#nodes-toggle", "#user-search", "#user-summary"].map((id) => [id, element()]));
  const details = { open: false };
  fields.get("#inventory").closest = () => details;
  const buttons = ["#save", "#append", "#replace", "#pool-reload"].map((id) => fields.get(id));
  const nestedButtons = (node) => [...(node.tagName === "button" ? [node] : []), ...node.children.flatMap(nestedButtons)];
  const root = { querySelector: (id) => fields.get(id), querySelectorAll: () => [
    ...buttons, ...nestedButtons(fields.get("#nodes")), ...nestedButtons(fields.get("#users")),
  ] };
  const calls = [];
  const events = [];
  const html = renderAccountPage({ isAdmin: true, adminRoutes: routes });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  vm.runInNewContext(scripts.at(-1)[1], {
    confirm, prompt, URL, Event, location: { href: "https://atlas.example/" },
    document: { getElementById: () => root, createElement: element, dispatchEvent: (event) => events.push(event.type) },
    fetch: async (path, options) => {
      calls.push({ path, options });
      path = new URL(path, "https://atlas.example").pathname;
      if (path === routes.state) return Response.json(initialState);
      assert.ok([routes.import, routes.nodes].includes(path));
      return respond(path, options);
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { fields, details, calls, routes, events, html };
}

function inventory() {
  return {
    revision: 3,
    users: [{ id: "member", email: "member@example.com", enabled: true, status: "active", groups: [] }],
    nodes: ["assigned", "available", "disabled"].map((id, index) => ({
      id, name: `🇺🇸 Example - ISP ${index + 1}`, group: "🇺🇸USA-ISP",
      line: `🇺🇸 Example - ISP ${index + 1} = trojan, node-${index + 1}.example.com, 443, password=TEST_ONLY`,
      enabled: id !== "disabled", ownerIds: id === "assigned" ? ["member"] : [], assignmentCount: id === "assigned" ? 1 : 0,
    })),
  };
}

function nodeRows(fields) {
  return fields.get("#nodes").children.filter((row) => row.className === "node-row");
}

function deleteButton(fields, index = 0) {
  return nodeRows(fields)[index].children.at(-1).children[0];
}

test("management reads and mutations use production endpoints without a branch selector", async () => {
  const { fields, calls } = await portal(() => Response.json({ nodes: [], added: 0, duplicates: 0, warnings: [], unknownExits: [] }));
  fields.get("#import").value = "https://subscription.example.com/node";
  await fields.get("#append").onclick();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ path }) => new URL(path, "https://atlas.example").search === ""));
});

test("the import button converts before updating the draft, shows warnings and prevents concurrent edits", async () => {
  let finish;
  const { fields, details, calls } = await portal(() => new Promise((resolve) => { finish = resolve; }));
  fields.get("#import").value = "https://subscription.example.com/node";
  const importing = fields.get("#append").onclick();
  assert.equal(fields.get("#inventory").readOnly, true);
  assert.equal(fields.get("#import").readOnly, true);
  assert.equal(fields.get("#save").disabled, true);
  assert.equal(fields.get("#replace").disabled, true);
  await fields.get("#replace").onclick();
  assert.equal(calls.length, 2, "concurrent clicks must not start another conversion");
  assert.equal(fields.get("#inventory").value, "[]");
  const options = calls.at(-1).options;
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(options.body), { text: "https://subscription.example.com/node", nodes: [] });
  const nodes = [{ id: "test-node", line: "🇺🇸 Example - ISP = vmess, node.example.com, 443", enabled: true }];
  finish(Response.json({ nodes, added: 1, duplicates: 2, warnings: ["请补充关键词 <test>"], unknownExits: [] }));
  await importing;
  assert.deepEqual(JSON.parse(fields.get("#inventory").value), nodes);
  assert.equal(fields.get("#import").value, "");
  assert.equal(fields.get("#import-notes").children[0].textContent, "请补充关键词 <test>");
  assert.equal(details.open, true);
  assert.match(fields.get(".status").textContent, /已加入 1 条节点，跳过 2 条/);
  assert.equal(fields.get("#inventory").readOnly, false);
  assert.equal(fields.get("#save").disabled, false);
  assert.equal(fields.get("#replace").disabled, false);
  assert.equal(calls.length, 2, "preview must not save automatically");
});

test("failed conversion preserves the pasted links and unsaved inventory", async () => {
  const { fields } = await portal(() => new Response("第 1 行：订阅请求失败。", { status: 400 }));
  const draft = '[{"id":"existing","line":"test = direct","enabled":false}]';
  fields.get("#inventory").value = draft;
  fields.get("#import").value = "https://subscription.example.com/node";
  await fields.get("#append").onclick();
  assert.equal(fields.get("#inventory").value, draft);
  assert.equal(fields.get("#import").value, "https://subscription.example.com/node");
  assert.match(fields.get(".status").textContent, /订阅请求失败/);
  assert.equal(fields.get("#inventory").readOnly, false);
  assert.equal(fields.get("#append").disabled, false);
});

test("unknown relay exits are filled in through prompts and converted again before updating the draft", async () => {
  const text = "https://subscription.example.com/node";
  const unknownExits = [{ code: "XY", name: "🇭🇰 HK-VMess-ISP-XY-1" }, { code: "PL", name: "🇭🇰 HK-ISP-PL" }];
  const responses = [
    { nodes: [{ id: "draft", line: "HK-VMess ISP-XY-1 = direct", enabled: true }], added: 1, duplicates: 0, warnings: ["无法识别"], unknownExits },
    { nodes: [{ id: "draft", line: "🇬🇧 UK-VMess ISP-1 = direct", enabled: true }], added: 1, duplicates: 0, warnings: [], unknownExits: [] },
  ];
  const converted = responses[1].nodes;
  const prompts = [];
  const answers = [" GB  UK UnitedKingdom ", null];
  const { fields, calls } = await portal(() => Response.json(responses.shift()), {
    prompt: (...args) => { prompts.push(args); return answers.shift(); },
  });
  fields.get("#import").value = text;
  await fields.get("#append").onclick();
  assert.deepEqual(prompts.map(([, value]) => value), ["XY XY ", "PL PL "]);
  assert.match(prompts[0][0], /无法识别中转出口 XY（🇭🇰 HK-VMess-ISP-XY-1）/);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[1].options.body), { text, nodes: [] });
  assert.deepEqual(JSON.parse(calls[2].options.body), { text, nodes: [], exits: { XY: { flag: "GB", code: "UK", name: "UnitedKingdom" } } });
  assert.deepEqual(JSON.parse(fields.get("#inventory").value), converted);
  assert.equal(fields.get("#import").value, "");
  assert.equal(fields.get("#import-notes").children.length, 0);
});

test("cancelled exit prompts keep the first conversion, while malformed answers preserve the links and draft", async () => {
  const text = "https://subscription.example.com/node";
  const first = { nodes: [{ id: "draft", line: "HK-VMess ISP-XY-1 = direct", enabled: true }], added: 1, duplicates: 0,
    warnings: ["无法识别中转出口 XY"], unknownExits: [{ code: "XY", name: "🇭🇰 HK-VMess-ISP-XY-1" }] };
  const cancelled = await portal(() => Response.json(first), { prompt: () => null });
  cancelled.fields.get("#import").value = text;
  await cancelled.fields.get("#append").onclick();
  assert.equal(cancelled.calls.length, 2);
  assert.deepEqual(JSON.parse(cancelled.fields.get("#inventory").value), first.nodes);
  assert.equal(cancelled.fields.get("#import-notes").children[0].textContent, "无法识别中转出口 XY");
  for (const answer of ["GB UnitedKingdom", "GB UK United Kingdom"]) {
    const { fields, calls } = await portal(() => Response.json(first), { prompt: () => answer });
    fields.get("#import").value = text;
    await fields.get("#append").onclick();
    assert.equal(calls.length, 2);
    assert.equal(fields.get("#inventory").value, "[]");
    assert.equal(fields.get("#import").value, text);
    assert.match(fields.get(".status").textContent, /请按“旗帜代码 简称 全称”填写 XY/);
  }
});

test("replacing converts with filled-in exits and confirms before dropping existing nodes from the draft", async () => {
  const text = "https://subscription.example.com/node";
  const converted = [
    { id: "assigned", line: "🇬🇧 UK-VMess ISP-1 = vmess, node-1.example.com, 443", enabled: true },
    { id: "fresh", line: "🇭🇰 HK-Hy2 ISP-1 = hysteria2, node-9.example.com, 443", enabled: true },
  ];
  const responses = [
    { nodes: [], added: 2, duplicates: 0, removed: 2, warnings: [], unknownExits: [{ code: "XY", name: "🇭🇰 HK-VMess-ISP-XY-1" }] },
    { nodes: converted, added: 1, duplicates: 3, removed: 2, warnings: ["已识别中转节点"], unknownExits: [] },
  ];
  const confirmations = [];
  const { fields, details, calls, html } = await portal(() => Response.json(responses.shift()), {
    initialState: inventory(), confirm: (message) => { confirmations.push(message); return true; }, prompt: () => "GB UK UnitedKingdom",
  });
  assert.ok(html.includes("转换并追加到待保存清单</button>"));
  assert.ok(html.includes("转换并替换已有节点</button>"));
  assert.equal(fields.get("#replace").disabled, false);
  const draft = JSON.parse(fields.get("#inventory").value);
  fields.get("#import").value = text;
  await fields.get("#replace").onclick();
  assert.deepEqual(calls.slice(1).map(({ options }) => JSON.parse(options.body)), [
    { text, nodes: draft, replace: true },
    { text, nodes: draft, replace: true, exits: { XY: { flag: "GB", code: "UK", name: "UnitedKingdom" } } },
  ]);
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /移除 2 个未出现在本次导入中的已有节点/);
  assert.deepEqual(JSON.parse(fields.get("#inventory").value), converted);
  assert.equal(fields.get("#import").value, "");
  assert.equal(fields.get("#import-notes").children[0].textContent, "已识别中转节点");
  assert.equal(details.open, true);
  assert.match(fields.get(".status").textContent, /已替换待保存清单：保留 1 个已有节点的 ID 和启停状态，新增 1 条，移除 2 条，跳过 3 条重复节点/);
  assert.equal(calls.length, 3, "replacement must not save automatically");
});

test("cancelled replacement keeps the draft and links, and nothing is asked when no node is dropped", async () => {
  const text = "https://subscription.example.com/node";
  const converted = [{ id: "assigned", line: "🇺🇸 US ISP-1 = vmess, node-1.example.com, 443", enabled: true }];
  const cancelled = await portal(() => Response.json({ nodes: converted, added: 0, duplicates: 0, removed: 2, warnings: ["ignored"], unknownExits: [] }), {
    initialState: inventory(), confirm: () => false,
  });
  const draft = cancelled.fields.get("#inventory").value;
  cancelled.fields.get("#import").value = text;
  await cancelled.fields.get("#replace").onclick();
  assert.equal(cancelled.fields.get("#inventory").value, draft);
  assert.equal(cancelled.fields.get("#import").value, text);
  assert.equal(cancelled.fields.get("#import-notes").children.length, 0);
  assert.match(cancelled.fields.get(".status").textContent, /已取消替换，待保存清单未改变/);
  assert.equal(cancelled.fields.get("#replace").disabled, false);

  const { fields } = await portal(() => Response.json({ nodes: converted, added: 1, duplicates: 0, removed: 0, warnings: [], unknownExits: [] }), {
    confirm: () => assert.fail("nothing is dropped from an empty draft"),
  });
  fields.get("#import").value = text;
  await fields.get("#replace").onclick();
  assert.deepEqual(JSON.parse(fields.get("#inventory").value), converted);
  assert.match(fields.get(".status").textContent, /保留 0 个已有节点的 ID 和启停状态，新增 1 条，移除 0 条/);
});

test("replacing through an import API without replacement support fails before prompting and keeps the draft", async () => {
  const text = "https://subscription.example.com/node";
  const { fields, calls } = await portal(() => Response.json({
    nodes: [{ id: "appended", line: "🇺🇸 US ISP-1 = direct", enabled: true }], added: 1, duplicates: 0, warnings: [],
    unknownExits: [{ code: "XY", name: "🇭🇰 HK-VMess-ISP-XY-1" }],
  }), { initialState: inventory(), confirm: () => assert.fail("unexpected confirmation") });
  const draft = fields.get("#inventory").value;
  fields.get("#import").value = text;
  await fields.get("#replace").onclick();
  assert.equal(calls.length, 2);
  assert.equal(fields.get("#inventory").value, draft);
  assert.equal(fields.get("#import").value, text);
  assert.match(fields.get(".status").textContent, /导入接口尚未支持替换/);
});

test("each node has a delete button; confirmed deletion saves only that removal and preserves other draft edits", async () => {
  let finish;
  const confirmations = [];
  const initialState = inventory();
  const { fields, calls, routes } = await portal(() => new Promise((resolve) => { finish = resolve; }), {
    initialState, confirm: (text) => { confirmations.push(text); return true; },
  });
  for (const [index, node] of initialState.nodes.entries()) {
    const button = deleteButton(fields, index);
    assert.equal(button.textContent, "删除");
    assert.equal(button.title, "删除 " + node.name);
    assert.equal(button.disabled, false);
  }
  const draft = JSON.parse(fields.get("#inventory").value);
  draft[1].line += ", sni=edited.example.com";
  draft.push({ id: "new", line: "🇭🇰 New - IDC = direct", enabled: true });
  fields.get("#inventory").value = JSON.stringify(draft);
  fields.get("#import").value = "https://subscription.example.com/pending";
  const removing = deleteButton(fields).onclick();
  assert.equal(confirmations.length, 1);
  assert.ok(confirmations[0].includes(initialState.nodes[0].name));
  assert.match(confirmations[0], /1 位用户/);
  assert.equal(fields.get("#inventory").readOnly, true);
  assert.equal(fields.get("#save").disabled, true);
  assert.equal(deleteButton(fields, 1).disabled, true);
  await deleteButton(fields, 1).onclick();
  assert.equal(calls.length, 2, "concurrent clicks must not start another mutation");
  const sent = calls.at(-1);
  assert.equal(sent.path, routes.nodes);
  assert.equal(sent.options.method, "PUT");
  assert.equal(sent.options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(sent.options.body), {
    revision: 3,
    nodes: initialState.nodes.slice(1).map(({ id, line, enabled }) => ({ id, line, enabled })),
  });
  const remaining = initialState.nodes.slice(1);
  finish(Response.json({ ...initialState, nodes: remaining, revision: 4 }));
  await removing;
  assert.deepEqual(JSON.parse(fields.get("#inventory").value), draft.slice(1));
  assert.equal(fields.get("#import").value, "https://subscription.example.com/pending");
  assert.equal(nodeRows(fields).length, 2);
  assert.equal(deleteButton(fields).title, "删除 " + remaining[0].name);
  assert.equal(fields.get("#inventory").readOnly, false);
  assert.equal(deleteButton(fields).disabled, false);
  assert.match(fields.get(".status").textContent, /节点已删除/);

  const removingDisabled = deleteButton(fields, 1).onclick();
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
    revision: 4, nodes: remaining.slice(0, 1).map(({ id, line, enabled }) => ({ id, line, enabled })),
  });
  finish(Response.json({ ...initialState, nodes: remaining.slice(0, 1), revision: 5 }));
  await removingDisabled;
  assert.deepEqual(JSON.parse(fields.get("#inventory").value), [draft[1], draft[3]]);
});

test("cancelled deletion leaves the node and unsaved editor unchanged without a request", async () => {
  const { fields, calls } = await portal(() => assert.fail("cancelled deletion must not save"), {
    initialState: inventory(), confirm: () => false,
  });
  const before = fields.get("#inventory").value;
  await deleteButton(fields).onclick();
  assert.equal(calls.length, 1);
  assert.equal(fields.get("#inventory").value, before);
  assert.equal(nodeRows(fields).length, 3);
  assert.equal(deleteButton(fields).disabled, false);
});

test("failed deletions preserve rows, editor and revision and can be retried", async () => {
  const { fields, calls } = await portal(() => new Response("Inventory changed; reload before saving", { status: 409 }), {
    initialState: inventory(),
  });
  const before = fields.get("#inventory").value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await deleteButton(fields).onclick();
    assert.equal(JSON.parse(calls.at(-1).options.body).revision, 3);
    assert.equal(fields.get("#inventory").value, before);
    assert.equal(nodeRows(fields).length, 3);
    assert.equal(deleteButton(fields).disabled, false);
    assert.match(fields.get(".status").textContent, /Inventory changed/);
  }
});

test("deleting the last node renders an empty five-column table and an empty editor", async () => {
  const initialState = inventory();
  initialState.nodes = initialState.nodes.slice(0, 1);
  const { fields, calls } = await portal(() => Response.json({ ...initialState, nodes: [], revision: 4 }), { initialState });
  await deleteButton(fields).onclick();
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { revision: 3, nodes: [] });
  assert.equal(fields.get("#inventory").value, "[]");
  assert.equal(fields.get("#nodes").children.length, 1);
  const row = fields.get("#nodes").children[0];
  assert.equal(row.hidden, false);
  assert.equal(row.children[0].colSpan, 5);
  assert.match(row.children[0].textContent, /暂无节点/);
});

test("node table groups connections, starts collapsed and filters by search and status", async () => {
  const initialState = inventory();
  initialState.nodes.push({ id: "hk", name: "🇭🇰 Example - IDC 1", group: "🇭🇰HK-IDC", line: "🇭🇰 Example - IDC 1 = direct",
    enabled: true, ownerIds: [], assignmentCount: 0 });
  const { fields, calls } = await portal(() => assert.fail("filters must not send requests"), { initialState });
  const rows = fields.get("#nodes").children;
  const headers = rows.filter((row) => row.className?.startsWith("group-row"));
  const visible = () => nodeRows(fields).filter((row) => !row.hidden).map((row) => row.children[0].children[0].textContent);
  const search = (value, status = "") => {
    fields.get("#node-search").value = value;
    fields.get("#node-status").value = status;
    fields.get("#node-search").oninput();
  };
  assert.deepEqual(headers.map((row) => row.children[0].children[0].children[0].textContent), ["🇺🇸USA-ISP", "🇭🇰HK-IDC"]);
  assert.equal(headers[0].children[0].colSpan, 5);
  assert.equal(headers[0].children[0].children[0].children[1].textContent, "3 个连接 · 2 个启用节点 · 1 位用户 · 1 个空闲 · 1 个连接停用");
  assert.deepEqual(visible(), []);
  assert.equal(fields.get("#node-summary").textContent, "共 4 个连接 · 2 个分组");
  headers[1].children[0].children[0].onclick();
  assert.deepEqual(visible(), ["🇭🇰 Example - IDC 1"]);
  assert.equal(headers[1].children[0].children[0].ariaExpanded, "true");
  fields.get("#nodes-toggle").onclick();
  assert.equal(visible().length, 4);
  assert.equal(fields.get("#nodes-toggle").textContent, "全部收起");
  fields.get("#nodes-toggle").onclick();
  assert.deepEqual(visible(), []);

  search("  MEMBER@example ");
  assert.deepEqual(visible(), [initialState.nodes[0].name]);
  assert.equal(headers[1].hidden, true);
  assert.equal(headers[0].children[0].children[0].disabled, true);
  assert.equal(fields.get("#nodes-toggle").disabled, true);
  assert.equal(fields.get("#node-summary").textContent, "匹配 1 / 4 个连接");
  search("isp", "idle");
  assert.deepEqual(visible(), [initialState.nodes[1].name]);
  search("", "disabled");
  assert.deepEqual(visible(), [initialState.nodes[2].name]);
  search("idc", "disabled");
  assert.deepEqual(visible(), []);
  assert.deepEqual([rows.at(-1).hidden, rows.at(-1).children[0].textContent], [false, "没有符合条件的连接。"]);
  search("");
  assert.deepEqual(visible(), []);
  assert.equal(rows.at(-1).hidden, true);
  assert.equal(fields.get("#nodes-toggle").disabled, false);
  assert.equal(calls.length, 1);
});

test("node owners list four users and fold the rest behind a counter", async () => {
  const initialState = inventory();
  initialState.users = Array.from({ length: 6 }, (_, index) => ({ id: "user-" + index, email: `user-${index}@example.com`,
    enabled: true, status: "active", groups: [] }));
  initialState.nodes[0].ownerIds = initialState.users.map(({ id }) => id);
  const { fields } = await portal(() => assert.fail("unexpected request"), { initialState });
  const owners = nodeRows(fields)[0].children[1].children;
  const shown = () => owners.filter(({ hidden }) => !hidden).map(({ textContent }) => textContent);
  const emails = initialState.users.map(({ email }) => email);
  assert.deepEqual(shown(), emails.slice(0, 4).concat("+2 人"));
  assert.equal(owners.at(-1).tagName, "button");
  assert.equal(owners.at(-1).title, "显示全部 6 位用户");
  assert.equal(nodeRows(fields)[0].children[2].children[0].textContent, "6 人");
  fields.get("#node-search").value = "user-0";
  fields.get("#node-search").oninput();
  assert.deepEqual(shown(), emails.slice(0, 4).concat("+2 人"));
  fields.get("#node-search").value = "user-5";
  fields.get("#node-search").oninput();
  assert.equal(nodeRows(fields)[0].hidden, false);
  assert.deepEqual(shown(), emails, "a search matching a folded owner reveals the full list");
});

test("the owner counter reveals the remaining users in place", async () => {
  const initialState = inventory();
  initialState.users = Array.from({ length: 5 }, (_, index) => ({ id: "user-" + index, email: `user-${index}@example.com`,
    enabled: true, status: "active", groups: [] }));
  initialState.nodes[0].ownerIds = initialState.users.map(({ id }) => id);
  const { fields } = await portal(() => assert.fail("unexpected request"), { initialState });
  const owners = nodeRows(fields)[0].children[1].children;
  owners.at(-1).onclick();
  assert.deepEqual(owners.filter(({ hidden }) => !hidden).map(({ textContent }) => textContent), initialState.users.map(({ email }) => email));
});

test("user rows summarize allocations, reveal fallback order on demand and filter by email", async () => {
  const initialState = inventory();
  initialState.users = [
    { id: "member", email: "member@example.com", enabled: true, status: "partial", groups: [
      { group: "🇺🇸USA-ISP", primaryId: "assigned", nodes: [{ id: "assigned", name: "Primary" }, { id: "available", name: "Backup" }] },
      { group: "🇭🇰HK-IDC", primaryId: null, nodes: [] },
    ] },
    { id: "paused", email: "paused@example.com", enabled: false, status: "pending", groups: [{ group: "🇺🇸USA-ISP", primaryId: null, nodes: [] }] },
  ];
  const { fields } = await portal(() => assert.fail("unexpected request"), { initialState });
  const [member, paused, empty] = fields.get("#users").children;
  const [summary, orders] = member.children[1].children;
  const toggle = summary.children.at(-1);
  assert.deepEqual(summary.children.map(({ textContent }) => textContent), ["已分配 1 / 2 组", "待分配：🇭🇰HK-IDC", "查看回退顺序"]);
  assert.deepEqual([orders.hidden, toggle.ariaExpanded], [true, "false"]);
  assert.deepEqual(orders.children.map(({ textContent }) => textContent), ["🇺🇸USA-ISP", ""]);
  assert.deepEqual(orders.children[1].children.map(({ textContent }) => textContent), ["Primary", "→", "Backup"]);
  toggle.onclick();
  assert.deepEqual([orders.hidden, toggle.ariaExpanded, toggle.textContent], [false, "true", "收起回退顺序"]);
  assert.deepEqual(paused.children[1].children.map(({ children }) => children.map(({ textContent }) => textContent)), [["已停用，不分配节点"]]);
  assert.equal(fields.get("#user-summary").textContent, "共 2 位用户");
  fields.get("#user-search").value = " PAUSED ";
  fields.get("#user-search").oninput();
  assert.deepEqual([member.hidden, paused.hidden, empty.hidden], [true, false, true]);
  assert.equal(fields.get("#user-summary").textContent, "匹配 1 / 2 位用户");
  fields.get("#user-search").value = "nobody";
  fields.get("#user-search").oninput();
  assert.deepEqual([empty.hidden, empty.children[0].textContent], [false, "没有匹配的用户。"]);
});

test("invalid draft JSON is preserved and must be fixed before deleting a node", async () => {
  const { fields, calls } = await portal(() => assert.fail("invalid draft must not save"), {
    initialState: inventory(), confirm: () => assert.fail("invalid draft must not ask for confirmation"),
  });
  for (const value of ["[{", "null", "{}"]) {
    fields.get("#inventory").value = value;
    await deleteButton(fields).onclick();
    assert.equal(calls.length, 1);
    assert.equal(fields.get("#inventory").value, value);
    assert.equal(nodeRows(fields).length, 3);
    assert.match(fields.get(".status").textContent, /请先修正后再删除/);
  }
});
