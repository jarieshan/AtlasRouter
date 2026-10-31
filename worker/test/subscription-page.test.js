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

test("subscription controls customize copied URLs and retain choices across token rotation", async () => {
  const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#enable-tencent-oa", "#tencent-oa-help", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
  fields.get("#subscription-client").value = "surge";
  let token = "ar_TEST_ONLY";
  let copied;
  const calls = [];
  const html = renderAccountPage();
  assert.match(html, /value="surge" selected/);
  assert.match(html, /id="enable-doh" type="checkbox"/);
  assert.match(html, /id="enable-tencent-oa" type="checkbox" role="switch"/);
  assert.match(html, /<span>Tencent OA Compatibility<\/span>/);
  assert.match(html, /腾讯公司内网/);
  assert.match(html, /关闭增强模式/);
  assert.match(html, /Surge Mac 仅开启系统代理，关闭增强模式；iOA需设置为全局模式/);
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element, addEventListener() {} },
    URL, location: { href: "https://atlas.example/" }, confirm: () => true,
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
  const tencentOa = fields.get("#enable-tencent-oa");
  assert.equal(tencentOa.checked, false);
  tencentOa.checked = true;
  tencentOa.onchange();
  assert.equal(fields.get("#subscription").value, `https://atlas.example/AtlasRouter?token=${token}&tencent_oa=1`);
  client.value = "clash";
  client.onchange();
  assert.equal(tencentOa.disabled, true);
  doh.checked = true;
  doh.onchange();
  assert.equal(calls.length, 1, "customizing a URL must not change the stored account or token");
  await fields.get("#copy").onclick();
  assert.equal(copied, `https://atlas.example/AtlasRouter?token=${token}&client=clash&doh=1`);
  await fields.get("#rotate").onclick();
  assert.equal(fields.get("#subscription").value, `https://atlas.example/AtlasRouter?token=${token}&client=clash&doh=1`);
  assert.match(fields.get("#client-help").textContent, /Mihomo/);
  client.value = "surge";
  client.onchange();
  assert.equal(tencentOa.disabled, false);
  assert.equal(fields.get("#subscription").value, `https://atlas.example/AtlasRouter?token=${token}&doh=1&tencent_oa=1`);
  await fields.get("#rotate").onclick();
  assert.equal(fields.get("#subscription").value, `https://atlas.example/AtlasRouter?token=${token}&doh=1&tencent_oa=1`);
  doh.checked = false;
  doh.onchange();
  tencentOa.checked = false;
  tencentOa.onchange();
  assert.equal(fields.get("#subscription").value, `https://atlas.example/AtlasRouter?token=${token}`);
});

test("development account calls, copied links and token rotation stay on develop", async () => {
  const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#enable-tencent-oa", "#tencent-oa-help", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
  fields.get("#subscription-client").value = "surge";
  let copied;
  let calls = 0;
  vm.runInNewContext(renderAccountPage().match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element, addEventListener() {} },
    URL, location: { href: "https://atlas.example/?dev=1" }, confirm: () => true,
    navigator: { clipboard: { writeText: async (value) => { copied = value; } } },
    fetch: async (path, options) => {
      calls += 1;
      const url = new URL(path, "https://atlas.example");
      assert.equal(url.searchParams.get("dev"), "1");
      assert.equal(url.pathname, calls === 1 ? ACCOUNT_PROFILE_PATH : ACCOUNT_TOKEN_PATH);
      assert.equal(options.method, calls === 1 ? "GET" : "POST");
      return Response.json({ email: "member@example.com", status: "active", groups: [],
        subscriptionUrl: `https://atlas.example/AtlasRouter?token=test-${calls}&dev=1` });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  fields.get("#subscription-client").value = "clash";
  fields.get("#subscription-client").onchange();
  await fields.get("#rotate").onclick();
  await fields.get("#copy").onclick();
  assert.equal(copied, "https://atlas.example/AtlasRouter?token=test-2&dev=1&client=clash");
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
    const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#enable-tencent-oa", "#tencent-oa-help", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
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
  fields.get("#enable-tencent-oa").checked = true;
  fields.get("#enable-tencent-oa").onchange();
  assert.equal(fields.get("#subscription").value, `${initial}&tencent_oa=1`);
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

test("Dev controls use development credentials while subscription links point directly to the preview", async () => {
  const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#enable-tencent-oa", "#tencent-oa-help", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
  fields.get("#subscription-client").value = "surge";
  let copied;
  let calls = 0;
  const html = renderAccountPage({ development: true, developmentAvailable: true });
  assert.match(html, /返回生产/);
  assert.match(html, /Dev · 开发环境/);
  assert.doesNotMatch(renderAccountPage({ preview: true, developmentAvailable: true }), /切换到开发环境/);
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element, addEventListener() {} },
    URL, location: { href: "https://atlas.example/?environment=development" }, confirm: () => true,
    navigator: { clipboard: { writeText: async (value) => { copied = value; } } },
    fetch: async (path, options) => {
      calls += 1;
      assert.equal(path, `${calls === 1 ? ACCOUNT_PROFILE_PATH : ACCOUNT_TOKEN_PATH}?environment=development`);
      assert.equal(options.method, calls === 1 ? "GET" : "POST");
      return Response.json({ email: "member@example.com", status: "active", groups: [],
        subscriptionUrl: `https://develop.atlas.example/AtlasRouter-Dev?token=dev-test-${calls}` });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  fields.get("#subscription-client").value = "clash";
  fields.get("#enable-doh").checked = true;
  fields.get("#subscription-client").onchange();
  await fields.get("#copy").onclick();
  assert.equal(copied, "https://develop.atlas.example/AtlasRouter-Dev?token=dev-test-1&client=clash&doh=1");
  await fields.get("#rotate").onclick();
  await fields.get("#copy").onclick();
  assert.equal(copied, "https://develop.atlas.example/AtlasRouter-Dev?token=dev-test-2&client=clash&doh=1");
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
  const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#enable-tencent-oa", "#tencent-oa-help", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
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
  const fields = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#enable-tencent-oa", "#tencent-oa-help", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
  fields.get("#subscription-client").value = "surge";
  const listeners = new Map();
  let requests = 0;
  vm.runInNewContext(renderAccountPage({ development: true }).match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: () => ({ querySelector: (id) => fields.get(id) }), createElement: element,
      addEventListener: (name, listener) => listeners.set(name, listener) },
    URL, location: { href: "https://atlas.example/?environment=development" },
    fetch: async (path, options) => {
      assert.equal(path, `${ACCOUNT_PROFILE_PATH}?environment=development`);
      assert.equal(options.method, "GET");
      requests += 1;
      return Response.json({ email: "member@example.com", status: requests === 1 ? "pending" : "active", groups: [],
        subscriptionUrl: "https://develop.atlas.example/AtlasRouter-Dev?token=TEST_ONLY" });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(fields.get(".status").textContent, /等待管理员/);
  fields.get("#subscription-client").value = "clash";
  fields.get("#enable-doh").checked = true;
  await listeners.get("atlasrouter:inventory")();
  assert.equal(requests, 2);
  assert.match(fields.get(".status").textContent, /配置已就绪/);
  assert.equal(fields.get("#subscription").value, "https://develop.atlas.example/AtlasRouter-Dev?token=TEST_ONLY&client=clash&doh=1");
});
