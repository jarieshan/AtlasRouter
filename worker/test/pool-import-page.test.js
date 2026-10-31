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

async function portal(respond, { initialState = { nodes: [], users: [], revision: 3 }, confirm = () => true, development = false, nativeDevelopment = false } = {}) {
  const routes = getAdminRoutes({ ADMIN_API_SLUG: "0123456789abcdef0123456789abcdef" });
  const fields = new Map([".status", "#inventory", "#import", "#import-notes", "#save", "#append", "#pool-reload", "#nodes", "#users", "#counts"].map((id) => [id, element()]));
  if (nativeDevelopment) fields.set("#reset-production", element("button"));
  const details = { open: false };
  fields.get("#inventory").closest = () => details;
  const buttons = ["#save", "#append", "#pool-reload"].map((id) => fields.get(id));
  if (nativeDevelopment) buttons.push(fields.get("#reset-production"));
  const nestedButtons = (node) => [...(node.tagName === "button" ? [node] : []), ...node.children.flatMap(nestedButtons)];
  const root = { querySelector: (id) => fields.get(id), querySelectorAll: () => [
    ...buttons, ...nestedButtons(fields.get("#nodes")), ...nestedButtons(fields.get("#users")),
  ] };
  const calls = [];
  const events = [];
  const html = renderAccountPage({ isAdmin: true, adminRoutes: routes, development: nativeDevelopment });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  vm.runInNewContext(scripts.at(-1)[1], {
    confirm, URL, Event, location: { href: `https://atlas.example/${nativeDevelopment ? "?environment=development" : development ? "?dev=1" : ""}` },
    document: { getElementById: () => root, createElement: element, dispatchEvent: (event) => events.push(event.type) },
    fetch: async (path, options) => {
      calls.push({ path, options });
      path = new URL(path, "https://atlas.example").pathname;
      if (path === routes.state) return Response.json(initialState);
      assert.ok([routes.import, routes.nodes, routes.resetProduction].includes(path));
      return respond(path, options);
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { fields, details, calls, routes, events, html };
}

test("only development administrators see the production reset button", () => {
  const adminRoutes = getAdminRoutes({ ADMIN_API_SLUG: "0123456789abcdef0123456789abcdef" });
  for (const options of [{}, { isAdmin: true, adminRoutes }, { development: true }, { isAdmin: true, adminRoutes, development: true, preview: true }]) {
    assert.doesNotMatch(renderAccountPage(options), /id="reset-production"/);
  }
  assert.match(renderAccountPage({ isAdmin: true, adminRoutes, development: true }), /id="reset-production"/);
});

test("only a click resets and saves the development pool, replaces drafts and refreshes the account", async () => {
  let finish;
  const { fields, calls, routes, events, html } = await portal(() => new Promise((resolve) => { finish = resolve; }), {
    nativeDevelopment: true, initialState: inventory(),
  });
  assert.match(html, /重置为生产节点/);
  assert.match(html, /仅点击时同步/);
  assert.match(html, /覆盖开发节点池和未保存的清单修改/);
  assert.equal(calls.length, 1, "loading the page must not reset nodes");
  assert.equal(calls[0].options.method, "GET");
  assert.deepEqual(events, []);
  fields.get("#inventory").value = "[{";
  fields.get("#import").value = "unsaved pasted text";
  fields.get("#import-notes").append(element("li"));
  const resetting = fields.get("#reset-production").onclick();
  assert.equal(fields.get("#reset-production").disabled, true);
  await fields.get("#reset-production").onclick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, `${routes.resetProduction}?environment=development`);
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), { revision: 3 });
  const result = { ...inventory(), revision: 4, nodes: inventory().nodes.slice(0, 2) };
  finish(Response.json(result));
  await resetting;
  assert.equal(fields.get("#nodes").children.length, 2);
  assert.deepEqual(JSON.parse(fields.get("#inventory").value), result.nodes.map(({ id, line, enabled }) => ({ id, line, enabled })));
  assert.equal(fields.get("#import").value, "unsaved pasted text");
  assert.equal(fields.get("#import-notes").children.length, 0);
  assert.match(fields.get(".status").textContent, /已重置为生产节点，共 2 条/);
  assert.equal(fields.get("#reset-production").disabled, false);
  assert.deepEqual(events, ["atlasrouter:inventory"]);
  assert.equal(calls.length, 2, "resetting must not require a second save request");
});

test("failed resets preserve the editor and do not refresh account state", async () => {
  const { fields, calls, events } = await portal(() => new Response("Inventory changed; reload before resetting", { status: 409 }), { nativeDevelopment: true });
  const draft = '[{"id":"draft","line":"test = direct","enabled":true}]';
  fields.get("#inventory").value = draft;
  await fields.get("#reset-production").onclick();
  assert.equal(calls.length, 2);
  assert.equal(fields.get("#inventory").value, draft);
  assert.match(fields.get(".status").textContent, /Inventory changed/);
  assert.equal(fields.get("#reset-production").disabled, false);
  assert.deepEqual(events, []);
});

test("resetting from an empty production pool clears the editor with an explicit message", async () => {
  const { fields, events } = await portal(() => Response.json({ nodes: [], users: [], revision: 4 }), {
    nativeDevelopment: true, initialState: inventory(),
  });
  await fields.get("#reset-production").onclick();
  assert.equal(fields.get("#inventory").value, "[]");
  assert.match(fields.get(".status").textContent, /生产节点池为空，开发节点池已清空/);
  assert.deepEqual(events, ["atlasrouter:inventory"]);
});

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

function deleteButton(fields, index = 0) {
  return fields.get("#nodes").children[index].children.at(-1).children[0];
}

test("development management reads and mutations retain the branch selector", async () => {
  const { fields, calls } = await portal(() => Response.json({ nodes: [], added: 0, duplicates: 0, warnings: [] }), { development: true });
  fields.get("#import").value = "https://subscription.example.com/node";
  await fields.get("#append").onclick();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ path }) => new URL(path, "https://atlas.example").searchParams.get("dev") === "1"));
});

test("the import button converts before updating the draft, shows warnings and prevents concurrent edits", async () => {
  let finish;
  const { fields, details, calls } = await portal(() => new Promise((resolve) => { finish = resolve; }));
  fields.get("#import").value = "https://subscription.example.com/node";
  const importing = fields.get("#append").onclick();
  assert.equal(fields.get("#inventory").readOnly, true);
  assert.equal(fields.get("#import").readOnly, true);
  assert.equal(fields.get("#save").disabled, true);
  assert.equal(fields.get("#inventory").value, "[]");
  const options = calls.at(-1).options;
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(options.body), { text: "https://subscription.example.com/node", nodes: [] });
  const nodes = [{ id: "test-node", line: "🇺🇸 Example - ISP = vmess, node.example.com, 443", enabled: true }];
  finish(Response.json({ nodes, added: 1, duplicates: 2, warnings: ["请补充关键词 <test>"] }));
  await importing;
  assert.deepEqual(JSON.parse(fields.get("#inventory").value), nodes);
  assert.equal(fields.get("#import").value, "");
  assert.equal(fields.get("#import-notes").children[0].textContent, "请补充关键词 <test>");
  assert.equal(details.open, true);
  assert.match(fields.get(".status").textContent, /已加入 1 条节点，跳过 2 条/);
  assert.equal(fields.get("#inventory").readOnly, false);
  assert.equal(fields.get("#save").disabled, false);
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
  assert.equal(fields.get("#nodes").children.length, 2);
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
  assert.equal(fields.get("#nodes").children.length, 3);
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
    assert.equal(fields.get("#nodes").children.length, 3);
    assert.equal(deleteButton(fields).disabled, false);
    assert.match(fields.get(".status").textContent, /Inventory changed/);
  }
});

test("deleting the last node renders an empty six-column table and an empty editor", async () => {
  const initialState = inventory();
  initialState.nodes = initialState.nodes.slice(0, 1);
  const { fields, calls } = await portal(() => Response.json({ ...initialState, nodes: [], revision: 4 }), { initialState });
  await deleteButton(fields).onclick();
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { revision: 3, nodes: [] });
  assert.equal(fields.get("#inventory").value, "[]");
  const row = fields.get("#nodes").children[0];
  assert.equal(row.children[0].colSpan, 6);
  assert.match(row.children[0].textContent, /暂无节点/);
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
    assert.equal(fields.get("#nodes").children.length, 3);
    assert.match(fields.get(".status").textContent, /请先修正后再删除/);
  }
});
