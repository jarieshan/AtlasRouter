import assert from "node:assert/strict";
import test from "node:test";
import { openPage } from "../test-helpers/page.js";

test("switching hot-loads the page and its panels use the selected environment", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const page = await openPage({ respond: async (url) => {
    if (url.pathname === "/") await pending;
  } });
  page.account.get("#subscription-client").value = "clash";
  page.account.get("#enable-doh").checked = false;
  page.account.get("#enable-wifi-assist").checked = true;
  const switching = page.change(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(page.account.get("#subscription").value, /PROD_TEST/);
  assert.match(page.pool.get("#inventory").value, /prod-node/);
  assert.equal(page.account.get("#copy").disabled, true);
  assert.equal(page.pool.get("#save").disabled, true);
  assert.equal(page.account.get("#enable-wifi-assist").disabled, true);
  assert.equal(page.swaps, 0);
  await page.pool.get("#save").onclick();
  assert.equal(page.calls.filter(({ options }) => options.method === "PUT").length, 0);
  release();
  await switching;
  assert.equal(page.swaps, 1);
  const devPage = page;
  const subscription = new URL(devPage.account.get("#subscription").value);
  assert.equal(subscription.searchParams.get("token"), "DEV_TEST");
  assert.equal(subscription.searchParams.get("client"), "clash");
  assert.equal(subscription.searchParams.get("doh"), "0");
  assert.equal(subscription.searchParams.get("wifi_assist"), "1");
  assert.match(devPage.pool.get("#inventory").value, /dev-node/);
  assert.equal(devPage.notice.hidden, false);
  await devPage.pool.get("#save").onclick();
  const write = devPage.calls.at(-1);
  assert.equal(write.development, true);
  assert.equal(JSON.parse(write.options.body).revision, 8);
  await devPage.change(false);
  assert.equal(page.swaps, 2);
  const productionPage = page;
  assert.match(productionPage.account.get("#subscription").value, /PROD_TEST/);
  assert.match(productionPage.pool.get("#inventory").value, /prod-node/);
  assert.equal(productionPage.notice.hidden, true);
  assert.equal(productionPage.account.get("#enable-wifi-assist").checked, true);
  assert.equal(productionPage.document.atlasrouterEnvironment.pending, 0);
});

test("a failed page request keeps the old environment, URL, account and unsaved node draft", async () => {
  const page = await openPage({ respond: (url) => url.pathname === "/"
    ? new Response("Development temporarily unavailable", { status: 503 }) : null });
  page.pool.get("#import").value = "https://subscription.example.com/pending";
  const draft = page.pool.get("#inventory").value;
  await page.change(true);
  assert.equal(page.account.get("#enable-dev").checked, false);
  assert.match(page.account.get("#subscription").value, /PROD_TEST/);
  assert.equal(page.pool.get("#inventory").value, draft);
  assert.equal(page.pool.get("#import").value, "https://subscription.example.com/pending");
  assert.equal(page.swaps, 0);
  assert.equal(page.location.href, "https://atlas.example/");
  assert.equal(page.notice.hidden, true);
  assert.equal(page.pool.get("#save").disabled, false);
  assert.equal(page.account.get("#enable-wifi-assist").disabled, false);
  assert.match(page.account.get(".status").textContent, /仍使用正式环境/);
});

test("login pages, stale page versions and network failures cannot complete an environment switch", async () => {
  for (const response of [
    () => new Response("Login", { headers: { "content-type": "text/html" } }),
    () => new Response("Old page", { headers: { "content-type": "text/html", "x-atlasrouter-page-environment": "production" } }),
    () => Response.json({}),
    () => { throw new Error("Network unavailable"); },
  ]) {
    const page = await openPage({ respond: (url) => url.pathname === "/" ? response() : null });
    await page.change(true);
    assert.equal(page.swaps, 0);
    assert.equal(page.account.get("#enable-dev").checked, false);
    assert.equal(page.account.get("#copy").disabled, false);
    assert.equal(page.document.atlasrouterEnvironment.changing, false);
  }
});

test("hot-loading installs the target scripts and styles and disposes previous document listeners", async () => {
  const page = await openPage({ transform: (html, development) => html
    .replaceAll("在 Surge 中通过 URL 安装配置。", development ? "Development module" : "Production module")
    .replace("--brand: #4f46e5", development ? "--brand: #123456" : "--brand: #654321") });
  const document = page.document;
  for (const development of [true, false, true, false]) {
    const oldListener = [...page.listeners.get("atlasrouter:inventory")][0];
    await page.change(development);
    assert.equal(page.document, document);
    assert.equal(page.document.atlasrouterEnvironment.development, development);
    assert.equal(page.document.atlasrouterEnvironment.panels.length, 2);
    assert.equal(page.listeners.get("atlasrouter:inventory").size, 1);
    assert.equal(page.listeners.get("atlasrouter:inventory").has(oldListener), false);
    assert.equal(page.account.get("#client-help").textContent, development ? "Development module" : "Production module");
    assert.ok(page.styles.includes(development ? "--brand: #123456" : "--brand: #654321"));
    const before = page.calls.length;
    await [...page.listeners.get("atlasrouter:inventory")][0]();
    assert.equal(page.calls.length, before + 1);
    assert.equal(page.calls.at(-1).development, development);
  }
});

test("an incomplete page leaves the current DOM, environment and listeners usable", async () => {
  const page = await openPage({ transform: (html) => html.replace('id="page-styles"', 'id="missing-styles"') });
  const oldAccount = page.account;
  const oldListener = [...page.listeners.get("atlasrouter:inventory")][0];
  await page.change(true);
  assert.equal(page.swaps, 0);
  assert.equal(page.account, oldAccount);
  assert.equal(page.listeners.get("atlasrouter:inventory").has(oldListener), true);
  assert.equal(page.document.atlasrouterEnvironment.development, false);
  assert.equal(page.document.atlasrouterEnvironment.changing, false);
  assert.equal(page.history.writes.length, 0);
  assert.match(page.account.get(".status").textContent, /页面内容不完整/);
  await page.pool.get("#save").onclick();
  assert.equal(page.calls.at(-1).development, false);
});

test("unsaved edits can cancel a switch without fetching or discarding content", async () => {
  const page = await openPage({ confirm: () => false });
  page.pool.get("#inventory").value = "UNSAVED DRAFT";
  await page.change(true);
  assert.equal(page.calls.length, 2);
  assert.equal(page.swaps, 0);
  assert.equal(page.account.get("#enable-dev").checked, false);
  assert.equal(page.pool.get("#inventory").value, "UNSAVED DRAFT");
});

test("an in-flight mutation prevents switching its destination", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const page = await openPage({ respond: async (_url, options) => { if (options.method === "PUT") await pending; } });
  const saving = page.pool.get("#save").onclick();
  await page.change(true);
  assert.equal(page.account.get("#enable-dev").checked, false);
  assert.equal(page.calls.at(-1).development, false);
  release();
  await saving;
  await page.change(true);
  assert.equal(new URL(page.location.href).searchParams.get("environment"), "development");
});
