import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { renderAccountPage } from "../src/pool-pages.js";
import { ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH } from "../src/routes.js";

function element() {
  return {
    value: "", checked: false, disabled: false, children: [], textContent: "",
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}

test("Dev is a switch alongside DoH and preserves client choices when changing environments", async () => {
  for (const active of [false, true]) {
    const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#enable-dev", "#install-tencent-oa", "#copy-tencent-oa", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
    fields.get("#subscription-client").value = "surge";
    fields.get("#enable-dev").checked = active;
    const location = { href: `https://atlas.example/?client=clash&doh=1${active ? "&environment=development" : ""}` };
    const calls = [];
    const html = renderAccountPage({ development: active, developmentAvailable: true });
    assert.match(html, new RegExp(`id="enable-dev" type="checkbox" role="switch"${active ? " checked" : ""}>`));
    assert.doesNotMatch(html, /environment-toggle/);
    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
      document: { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element, addEventListener() {} },
      URL, location, confirm: () => true,
      fetch: async (path) => {
        calls.push(path);
        return Response.json({ email: "member@example.com", status: "active", groups: [],
          subscriptionUrl: `https://atlas.example/AtlasRouter?${active ? "dev=1&" : ""}token=TEST_ONLY` });
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(new URL(calls[0], location.href).searchParams.get("environment"), active ? "development" : null);
    const subscription = new URL(fields.get("#subscription").value);
    assert.equal(subscription.searchParams.get("dev"), active ? "1" : null);
    assert.equal(subscription.searchParams.get("client"), "clash");
    assert.equal(subscription.searchParams.get("doh"), "1");
    fields.get("#enable-dev").checked = !active;
    fields.get("#enable-dev").onchange();
    const next = new URL(location.href);
    assert.equal(next.searchParams.get("environment"), active ? null : "development");
    assert.equal(next.searchParams.get("client"), "clash");
    assert.equal(next.searchParams.get("doh"), "1");
    assert.equal(calls.length, 1, "switching must not rotate or edit either account");
  }
  assert.doesNotMatch(renderAccountPage({ preview: true, developmentAvailable: true }), /id="enable-dev"/);
});

test("subscription controls customize copied URLs and retain choices across token rotation", async () => {
  const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#install-tencent-oa", "#copy-tencent-oa", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
  fields.get("#subscription-client").value = "surge";
  let token = "ar_TEST_ONLY";
  let copied;
  const calls = [];
  const location = { href: "https://atlas.example/" };
  const moduleUrl = () => `https://atlas.example/AtlasRouter/modules/tencent-oa.sgmodule?token=${token}`;
  const html = renderAccountPage();
  assert.match(html, /value="surge" selected/);
  assert.match(html, /id="enable-doh" type="checkbox"/);
  assert.doesNotMatch(html, /enable-tencent-oa|tencent_oa/);
  assert.match(html, /<span>Tencent OA Compatibility<\/span>/);
  assert.match(html, /id="install-tencent-oa"/);
  assert.match(html, /id="copy-tencent-oa"/);
  assert.match(html, /腾讯公司内网/);
  assert.match(html, /关闭增强模式/);
  assert.match(html, /iOA 需设置为全局模式/);
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element, addEventListener() {} },
    URL, location, confirm: () => true,
    navigator: { clipboard: { writeText: async (value) => { copied = value; } } },
    fetch: async (path, options) => {
      calls.push({ path, options });
      assert.ok([ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH].includes(path));
      if (path === ACCOUNT_TOKEN_PATH) { assert.equal(options.method, "POST"); token = "ar_ROTATED_TEST_ONLY"; }
      return Response.json({ email: "member@example.com", status: "active", groups: [], subscriptionUrl: `https://atlas.example/AtlasRouter?token=${token}` });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fields.get("#subscription").value, `https://atlas.example/AtlasRouter?token=${token}`);
  const client = fields.get("#subscription-client");
  const doh = fields.get("#enable-doh");
  assert.equal(fields.get("#install-tencent-oa").disabled, false);
  await fields.get("#copy-tencent-oa").onclick();
  assert.equal(copied, moduleUrl());
  client.value = "clash";
  client.onchange();
  doh.checked = true;
  doh.onchange();
  assert.equal(calls.length, 1, "customizing a URL must not change the stored account or token");
  await fields.get("#copy").onclick();
  assert.equal(copied, `https://atlas.example/AtlasRouter?token=${token}&client=clash&doh=1`);
  await fields.get("#rotate").onclick();
  assert.equal(fields.get("#subscription").value, `https://atlas.example/AtlasRouter?token=${token}&client=clash&doh=1`);
  assert.match(fields.get("#client-help").textContent, /Mihomo/);
  await fields.get("#copy-tencent-oa").onclick();
  assert.equal(copied, moduleUrl());
  client.value = "surge";
  client.onchange();
  assert.equal(fields.get("#subscription").value, `https://atlas.example/AtlasRouter?token=${token}&doh=1`);
  doh.checked = false;
  doh.onchange();
  assert.equal(fields.get("#subscription").value, `https://atlas.example/AtlasRouter?token=${token}`);
  fields.get("#install-tencent-oa").onclick();
  assert.equal(location.href, `surge:///install-module?url=${encodeURIComponent(moduleUrl())}`);
});

test("production account calls and copied links retain token rotation", async () => {
  const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#install-tencent-oa", "#copy-tencent-oa", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
  fields.get("#subscription-client").value = "surge";
  let copied;
  let calls = 0;
  vm.runInNewContext(renderAccountPage().match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element, addEventListener() {} },
    URL, location: { href: "https://atlas.example/" }, confirm: () => true,
    navigator: { clipboard: { writeText: async (value) => { copied = value; } } },
    fetch: async (path, options) => {
      calls += 1;
      const url = new URL(path, "https://atlas.example");
      assert.equal(url.searchParams.has("dev"), false);
      assert.equal(url.pathname, calls === 1 ? ACCOUNT_PROFILE_PATH : ACCOUNT_TOKEN_PATH);
      assert.equal(options.method, calls === 1 ? "GET" : "POST");
      return Response.json({ email: "member@example.com", status: "active", groups: [],
        subscriptionUrl: `https://atlas.example/AtlasRouter?token=test-${calls}` });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  fields.get("#subscription-client").value = "clash";
  fields.get("#subscription-client").onchange();
  await fields.get("#rotate").onclick();
  await fields.get("#copy").onclick();
  assert.equal(copied, "https://atlas.example/AtlasRouter?token=test-2&client=clash");
  await fields.get("#copy-tencent-oa").onclick();
  assert.equal(copied, "https://atlas.example/AtlasRouter/modules/tencent-oa.sgmodule?token=test-2");
  assert.equal(calls, 2);
});

test("page previews keep all interactions in memory and reset on a new page load", async () => {
  const html = renderAccountPage({ preview: true, isAdmin: true });
  assert.match(html, /页面预览/);
  assert.doesNotMatch(html, /id="pool-panel"/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  let fetches = 0;
  let storageAccesses = 0;
  let copied;
  async function openPage() {
    const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#install-tencent-oa", "#copy-tencent-oa", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
    fields.get("#subscription-client").value = "surge";
    const storage = new Proxy({}, { get() { storageAccesses += 1; throw new Error("Preview must not use browser storage"); } });
    const document = { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element, addEventListener() {} };
    Object.defineProperty(document, "cookie", { set() { storageAccesses += 1; throw new Error("Preview must not save cookies"); } });
    vm.runInNewContext(script, {
      document, URL, confirm: () => true, localStorage: storage, sessionStorage: storage, indexedDB: storage,
      crypto: { randomUUID: () => "test-only-new-preview" },
      navigator: { clipboard: { writeText: async (value) => { copied = value; } } },
      fetch: () => { fetches += 1; throw new Error("Preview must not fetch any data"); },
    });
    await new Promise((resolve) => setImmediate(resolve));
    return fields;
  }
  const fields = await openPage();
  const initial = fields.get("#subscription").value;
  assert.equal(new URL(initial).hostname, "preview.invalid");
  assert.equal(fields.get("#identity").textContent, "preview@example.invalid");
  assert.equal(fields.get("#groups").children.length, 4);
  await fields.get("#copy-tencent-oa").onclick();
  assert.equal(copied, initial.replace("/AtlasRouter?", "/AtlasRouter/modules/tencent-oa.sgmodule?"));
  fields.get("#install-tencent-oa").onclick();
  assert.match(fields.get(".status").textContent, /页面预览不会安装模块/);
  fields.get("#subscription-client").value = "clash";
  fields.get("#subscription-client").onchange();
  fields.get("#enable-doh").checked = true;
  fields.get("#enable-doh").onchange();
  await fields.get("#copy").onclick();
  assert.equal(copied, `${initial}&client=clash&doh=1`);
  await fields.get("#rotate").onclick();
  const rotated = fields.get("#subscription").value;
  assert.notEqual(rotated, copied);
  assert.equal(new URL(rotated).searchParams.get("token"), "preview-test-only-new-preview");
  assert.equal((await openPage()).get("#subscription").value, initial);
  assert.equal(fetches, 0);
  assert.equal(storageAccesses, 0);
});

test("database node labels render as text and preview interactions stay in the page", async () => {
  const name = '🇺🇸 ISP </script><script>alert("test")</script>';
  const profile = {
    nodeSource: "database", email: "preview@example.invalid", status: "active",
    subscriptionUrl: "https://preview.invalid/AtlasRouter?token=preview",
    groups: [{ group: "🇺🇸USA-ISP", primaryId: "stored", nodes: [{ id: "stored", name }] }],
  };
  const html = renderAccountPage({ preview: true, previewProfile: profile });
  assert.match(html, /节点池预览/);
  assert.match(html, /只读展示当前启用的真实节点/);
  assert.equal(html.match(/<script>/g).length, 1);
  assert.ok(!html.includes(name));
  const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#install-tencent-oa", "#copy-tencent-oa", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
  fields.get("#subscription-client").value = "surge";
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element, addEventListener() {} },
    URL, confirm: () => true, crypto: { randomUUID: () => "test-only" },
    fetch: () => assert.fail("Preview interactions must not send requests"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  const nodeName = () => fields.get("#groups").children[0].children[1].children[0].children[1].textContent;
  assert.equal(nodeName(), name);
  assert.match(fields.get(".status").textContent, /真实节点/);
  await fields.get("#rotate").onclick();
  assert.equal(nodeName(), name);
  assert.equal(new URL(fields.get("#subscription").value).hostname, "preview.invalid");
});


test("inventory updates refresh the account without rotating its token or resetting options", async () => {
  const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#install-tencent-oa", "#copy-tencent-oa", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
  fields.get("#subscription-client").value = "surge";
  const listeners = new Map();
  let requests = 0;
  vm.runInNewContext(renderAccountPage().match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element,
      addEventListener: (name, listener) => listeners.set(name, listener) },
    URL, location: { href: "https://atlas.example/" },
    fetch: async (path, options) => {
      assert.equal(path, ACCOUNT_PROFILE_PATH);
      assert.equal(options.method, "GET");
      requests += 1;
      return Response.json({ email: "member@example.com", status: requests === 1 ? "pending" : "active", groups: [],
        subscriptionUrl: "https://atlas.example/AtlasRouter?token=TEST_ONLY" });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(fields.get(".status").textContent, /等待管理员/);
  fields.get("#subscription-client").value = "clash";
  fields.get("#enable-doh").checked = true;
  await listeners.get("atlasrouter:inventory")();
  assert.equal(requests, 2);
  assert.match(fields.get(".status").textContent, /配置已就绪/);
  assert.equal(fields.get("#subscription").value, "https://atlas.example/AtlasRouter?token=TEST_ONLY&client=clash&doh=1");
});
