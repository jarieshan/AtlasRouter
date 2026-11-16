import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { renderAccountPage } from "../src/pool-pages.js";
import { getAdminRoutes, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH } from "../src/routes.js";

function element(tagName) {
  return { tagName, value: "", checked: false, disabled: false, readOnly: false, children: [], textContent: "",
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    closest() { return { open: false }; },
  };
}

async function openPage({ respond = () => null, confirm = () => true, href = "https://atlas.example/" } = {}) {
  const routes = getAdminRoutes({ ADMIN_API_SLUG: "0123456789abcdef0123456789abcdef" });
  const account = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#enable-tencent-oa", "#tencent-oa-help", "#enable-wifi-assist", "#wifi-assist-help", "#enable-dev", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
  const pool = new Map([".status", "#inventory", "#import", "#import-notes", "#save", "#append", "#pool-reload", "#nodes", "#users", "#counts"].map((id) => [id, element()]));
  account.get("#subscription-client").value = "surge";
  const development = new URL(href).searchParams.get("environment") === "development";
  account.get("#enable-dev").checked = development;
  const notice = { hidden: !development };
  const roots = { "account-panel": { querySelector: (id) => account.get(id) },
    "pool-panel": { querySelector: (id) => pool.get(id), querySelectorAll: () => [pool.get("#save"), pool.get("#append"), pool.get("#pool-reload")] } };
  const listeners = new Map();
  const document = { getElementById: (id) => id === "development-notice" ? notice : roots[id], createElement: element,
    addEventListener(name, listener) { listeners.set(name, listener); } };
  const navigations = [];
  const location = { href, replace(url) { navigations.push(url); } };
  const calls = [];
  const state = (development) => ({ revision: development ? 8 : 2, users: [], nodes: [{
    id: development ? "dev-node" : "prod-node", name: development ? "Development" : "Production",
    line: (development ? "Development" : "Production") + " = direct", enabled: true,
    group: "Test", ownerIds: [], assignmentCount: 0,
  }] });
  const context = vm.createContext({ document, URL, location, confirm,
    fetch: async (path, options) => {
      const url = new URL(path, href);
      const development = url.pathname.startsWith("/api/AtlasRouter-Dev/");
      calls.push({ path, options, development });
      const response = await respond(url, options);
      if (response) return response;
      if (url.pathname === "/") return new Response("<html>Selected page</html>", { headers: {
        "content-type": "text/html",
        "x-atlasrouter-page-environment": url.searchParams.get("environment") === "development" ? "development" : "production",
      } });
      if (development) url.pathname = url.pathname.replace("/api/AtlasRouter-Dev/", "/api/");
      if (url.pathname === ACCOUNT_PROFILE_PATH || url.pathname === ACCOUNT_TOKEN_PATH) {
        return Response.json({ email: "member@example.com", status: "active", groups: [],
          subscriptionUrl: `https://atlas.example/AtlasRouter${development ? "-Dev" : ""}?token=${development ? "DEV_TEST" : "PROD_TEST"}` });
      }
      assert.ok([routes.state, routes.nodes].includes(url.pathname));
      return Response.json(state(development));
    },
  });
  const html = renderAccountPage({ isAdmin: true, adminRoutes: routes, development, developmentAvailable: true });
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { account, pool, notice, document, location, navigations, calls, routes,
    async change(selected) { account.get("#enable-dev").checked = selected; await account.get("#enable-dev").onchange(); },
  };
}

test("switching checks the new page before navigation and its reloaded panels use the selected environment", async () => {
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
  assert.deepEqual(page.navigations, []);
  await page.pool.get("#save").onclick();
  assert.equal(page.calls.filter(({ options }) => options.method === "PUT").length, 0);
  release();
  await switching;
  assert.equal(page.navigations.length, 1);
  const devPage = await openPage({ href: page.navigations[0] });
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
  const productionPage = await openPage({ href: devPage.navigations[0] });
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
  assert.equal(page.navigations.length, 0);
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
    assert.deepEqual(page.navigations, []);
    assert.equal(page.account.get("#enable-dev").checked, false);
    assert.equal(page.account.get("#copy").disabled, false);
    assert.equal(page.document.atlasrouterEnvironment.changing, false);
  }
});

test("unsaved edits can cancel a switch without fetching or discarding content", async () => {
  const page = await openPage({ confirm: () => false });
  page.pool.get("#inventory").value = "UNSAVED DRAFT";
  await page.change(true);
  assert.equal(page.calls.length, 2);
  assert.deepEqual(page.navigations, []);
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
  assert.equal(new URL(page.navigations[0]).searchParams.get("environment"), "development");
});
