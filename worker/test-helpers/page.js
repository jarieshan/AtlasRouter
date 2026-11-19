import assert from "node:assert/strict";
import vm from "node:vm";
import { renderAccountPage } from "../src/pool-pages.js";
import { getAdminRoutes, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH } from "../src/routes.js";

function element(tagName) {
  return { tagName, value: "", checked: false, disabled: false, readOnly: false, children: [], textContent: "",
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    closest() { return { open: false }; },
    focus() { this.focused = true; },
  };
}

export async function openPage({ respond = () => null, confirm = () => true, href = "https://atlas.example/",
  isAdmin = true, transform = (html) => html } = {}) {
  const routes = getAdminRoutes({ ADMIN_API_SLUG: "0123456789abcdef0123456789abcdef" });
  function parse(html) {
    const account = new Map([".status", "#subscription", "#copy", "#rotate", "#subscription-client", "#enable-doh", "#enable-vless", "#enable-tencent-oa", "#tencent-oa-help", "#enable-wifi-assist", "#wifi-assist-help", "#enable-dev", "#client-help", "#identity", "#groups"].map((id) => [id, element()]));
    const pool = new Map([".status", "#inventory", "#import", "#import-notes", "#save", "#append", "#replace", "#pool-reload", "#nodes", "#users", "#counts"].map((id) => [id, element()]));
    account.get("#subscription-client").value = "surge";
    const development = /id="enable-dev"[^>]* checked/.test(html);
    account.get("#enable-dev").checked = development;
    const notice = { hidden: !development };
    const roots = { "account-panel": html.includes('id="account-panel"') ? { querySelector: (id) => account.get(id) } : null,
      "pool-panel": { querySelector: (id) => pool.get(id), querySelectorAll: () => [pool.get("#save"), pool.get("#append"), pool.get("#replace"), pool.get("#pool-reload")] } };
    const styles = html.match(/<style id="page-styles">([\s\S]*?)<\/style>/)?.[1];
    const style = styles === undefined ? null : { textContent: styles, replaceWith(next) { this.textContent = next.textContent; } };
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, textContent]) => ({ textContent, attributes: [], remove() {} }));
    const page = { account, pool, notice, roots, scripts, style, title: html.match(/<title>(.*?)<\/title>/)?.[1],
      getElementById(id) {
        if (id === "page-styles") return style;
        if (id === "development-notice") return notice;
        return roots[id] ?? account.get("#" + id);
      },
      querySelectorAll(selector) { assert.equal(selector, "script"); return scripts; },
    };
    page.body = { childNodes: [page] };
    return page;
  }
  const html = renderAccountPage({ isAdmin, adminRoutes: routes, development: new URL(href).searchParams.get("environment") === "development", developmentAvailable: true });
  let current = parse(html);
  let swaps = 0;
  const listeners = new Map();
  const document = { getElementById: (id) => current.getElementById(id), createElement: element,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    body: {
      replaceChildren(page) { current = page; swaps += 1; },
      append(script) { vm.runInContext(script.textContent, context); },
    },
  };
  const location = { get href() { return href; }, set href(_) { assert.fail("The document must not navigate"); },
    replace() { assert.fail("The document must not navigate"); } };
  const history = { writes: [], replaceState(_state, _title, url) { href = url.toString(); this.writes.push(href); } };
  const calls = [];
  const state = (development) => ({ revision: development ? 8 : 2, users: [], nodes: [{
    id: development ? "dev-node" : "prod-node", name: development ? "Development" : "Production",
    line: (development ? "Development" : "Production") + " = direct", enabled: true,
    group: "Test", ownerIds: [], assignmentCount: 0,
  }] });
  const context = vm.createContext({ document, URL, location, history, confirm,
    DOMParser: class { parseFromString(html, type) { assert.equal(type, "text/html"); return parse(html); } },
    fetch: async (path, options) => {
      const url = new URL(path, href);
      const development = url.pathname.startsWith("/api/AtlasRouter-Dev/");
      calls.push({ path, options, development });
      const response = await respond(url, options);
      if (response) return response;
      if (url.pathname === "/") {
        const selected = url.searchParams.get("environment") === "development";
        const body = transform(renderAccountPage({ isAdmin, adminRoutes: routes, development: selected, developmentAvailable: true }), selected);
        return new Response(body, { headers: {
          "content-type": "text/html", "x-atlasrouter-page-environment": selected ? "development" : "production",
        } });
      }
      if (development) url.pathname = url.pathname.replace("/api/AtlasRouter-Dev/", "/api/");
      if (url.pathname === ACCOUNT_PROFILE_PATH || url.pathname === ACCOUNT_TOKEN_PATH) {
        return Response.json({ email: "member@example.com", status: "active", groups: [],
          subscriptionUrl: `https://atlas.example/AtlasRouter${development ? "-Dev" : ""}?token=${development ? "DEV_TEST" : "PROD_TEST"}` });
      }
      assert.ok([routes.state, routes.nodes].includes(url.pathname));
      return Response.json(state(development));
    },
  });
  for (const script of current.scripts) vm.runInContext(script.textContent, context);
  await new Promise((resolve) => setImmediate(resolve));
  return { get account() { return current.account; }, get pool() { return current.pool; }, get notice() { return current.notice; },
    get swaps() { return swaps; }, get styles() { return current.style.textContent; },
    document, location, history, calls, routes, listeners,
    async change(selected) {
      current.account.get("#enable-dev").checked = selected;
      await current.account.get("#enable-dev").onchange();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}
