import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { findMagicRuleSource, magicRuleUrl } from "../src/magic-rules.js";
import { handleRequest } from "../src/index.js";
import { createD1Env } from "../test-helpers/d1.js";
import { readSubscriptionState } from "../src/subscription-db.js";
import { ACCOUNT_PATH, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH, POOL_SUBSCRIPTION_PATH, getAdminRoutes } from "../src/routes.js";

const TEAM_DOMAIN = "https://team.cloudflareaccess.com";
const ACCESS_AUD = "access-aud";
const ADMIN_EMAIL = "admin@example.com";
const ACCESS_KID = "test-key";
const ADMIN_API_SLUG = "0123456789abcdef0123456789abcdef";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const accessJwk = { ...publicKey.export({ format: "jwk" }), kid: ACCESS_KID, alg: "RS256", use: "sig" };
const routes = getAdminRoutes({ ADMIN_API_SLUG });

function createEnv() {
  return Object.assign(createD1Env(), {
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD, ADMIN_EMAILS: ADMIN_EMAIL,
    ADMIN_API_SLUG, ACCESS_JWKS_JSON: JSON.stringify({ keys: [accessJwk] }),
  });
}

function unreadableEnv() {
  const env = createEnv();
  env.DB.prepare = () => assert.fail("this request must not access D1");
  return env;
}

function request(path, options = {}, env = createEnv()) {
  return handleRequest(new Request(`https://atlas.example${path}`, options), env);
}

test("all active browser routes reject missing and substitute credentials before reading D1", async () => {
  const env = unreadableEnv();
  for (const path of [ACCOUNT_PATH, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH, ...Object.values(routes)]) {
    for (const headers of [
      {}, { authorization: "Bearer test-only" }, { "cf-access-authenticated-user-email": ADMIN_EMAIL },
      { "cf-access-jwt-assertion": "bogus" },
    ]) {
      const response = await request(`${path}?admin_token=test-only`, { headers }, env);
      assert.equal(response.status, 403);
      assertSecurityHeaders(response);
      assert.ok(!(await response.text()).includes(ADMIN_API_SLUG));
    }
  }
});

test("only verified administrators receive management routes in the root page", async () => {
  const env = unreadableEnv();
  for (const [email, admin] of [[ADMIN_EMAIL, true], ["member@example.com", false]]) {
    const response = await request("/?role=admin&email=admin@example.com", {
      headers: { ...accessHeaders({ email }), "x-role": "admin", "cf-access-authenticated-user-email": ADMIN_EMAIL },
    }, env);
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
    const body = await response.text();
    assert.equal(body.includes('id="pool-panel"'), admin);
    assert.equal(body.includes(ADMIN_API_SLUG), admin);
    assert.ok(body.includes(ACCOUNT_PROFILE_PATH));
    assert.ok(body.includes(ACCOUNT_TOKEN_PATH));
    assert.doesNotMatch(body, /href="\/admin"|原有手动配置|\/api\/admin|caP12/);
  }
});

test("preview pages require Access but never read the database or expose administrator controls", async () => {
  const env = unreadableEnv();
  assert.equal((await request("/?preview=1", {}, env)).status, 403);
  for (const email of [ADMIN_EMAIL, "preview@example.com"]) {
    const response = await request("/?preview=1", { headers: accessHeaders({ email }) }, env);
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
    const body = await response.text();
    assert.match(body, /页面预览/);
    assert.match(body, /preview\.invalid/);
    assert.doesNotMatch(body, /id="pool-panel"/);
    assert.ok(!body.includes(ADMIN_API_SLUG));
    assert.ok(!body.includes(email));
  }
});

test("configured preview identities only read node labels through the normal page and account APIs", async () => {
  const env = createEnv();
  const saved = await request(routes.nodes, {
    method: "PUT", headers: { ...accessHeaders(), origin: "https://atlas.example", "content-type": "application/json" },
    body: JSON.stringify({ revision: 0, nodes: [
      { id: "usa", line: "🇺🇸 Stored ISP = trojan, example.com, 443, password=TEST_ONLY" },
      { id: "japan", line: "🇯🇵 Stored WARP = trojan, example.com, 443, password=TEST_ONLY" },
      { id: "disabled", enabled: false, line: "🇭🇰 Disabled IDC = trojan, example.com, 443, password=TEST_ONLY" },
    ] }),
  }, env);
  assert.equal(saved.status, 200);
  const writes = env.writeCount;
  const prepare = env.DB.prepare;
  let reads = 0;
  env.DB.prepare = (sql) => {
    assert.equal(sql, "SELECT id, name, group_name FROM nodes WHERE enabled = 1 ORDER BY sort_order");
    reads += 1;
    return prepare(sql);
  };
  env.DB.batch = () => assert.fail("Preview must not access the write path or account state");
  env.PREVIEW_EMAIL_HASHES = createHash("sha256").update(ADMIN_EMAIL).digest("hex");
  const headers = { ...accessHeaders({ email: ` ${ADMIN_EMAIL.toUpperCase()} ` }), origin: "https://atlas.example", "content-type": "application/json" };
  for (const path of ["/", "/?preview=0", "/?preview=1"]) {
    const response = await request(path, { headers }, env);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /页面预览/);
    assert.match(body, /🇺🇸 Stored ISP/);
    assert.doesNotMatch(body, /Disabled IDC|TEST_ONLY/);
    assert.doesNotMatch(body, /id="pool-panel"/);
    assert.ok(!body.includes(ADMIN_EMAIL));
    assert.ok(!body.includes(env.PREVIEW_EMAIL_HASHES));
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    for (const [path, method] of [[ACCOUNT_PROFILE_PATH, "GET"], [ACCOUNT_TOKEN_PATH, "POST"]]) {
      const response = await request(path, { method, headers, ...(method === "POST" ? { body: "{}" } : {}) }, env);
      assert.equal(response.status, 200);
      assertSecurityHeaders(response);
      const profile = await response.json();
      assert.equal(profile.email, "preview@example.invalid");
      assert.equal(new URL(profile.subscriptionUrl).hostname, "preview.invalid");
      assert.equal(profile.nodeSource, "database");
      assert.deepEqual(profile.groups, [
        { group: "🇺🇸USA-ISP", primaryId: "usa", nodes: [{ id: "usa", name: "🇺🇸 Stored ISP" }] },
        { group: "🇯🇵JP-WARP", primaryId: "japan", nodes: [{ id: "japan", name: "🇯🇵 Stored WARP" }] },
      ]);
    }
  }
  for (const path of Object.values(routes)) assert.equal((await request(path, { headers }, env)).status, 403);
  assert.equal((await request(ACCOUNT_PROFILE_PATH, {}, env)).status, 403);
  assert.equal((await request(ACCOUNT_TOKEN_PATH, { method: "POST", headers: { ...headers, origin: "https://foreign.example" }, body: "{}" }, env)).status, 403);
  assert.equal(reads, 9, "authorization failures must not read any node data");
  assert.equal(env.writeCount, writes);
});

test("knowing the random route never grants administrator access", async () => {
  const env = unreadableEnv();
  for (const email of ["member@example.com", "", undefined, [ADMIN_EMAIL]]) {
    for (const path of Object.values(routes)) {
      const response = await request(path, { headers: accessHeaders({ email }) }, env);
      assert.equal(response.status, 403);
      assert.equal(await response.text(), "Forbidden");
    }
  }
});

test("Access authorization runs before method handling on management routes", async () => {
  const env = unreadableEnv();
  for (const path of Object.values(routes)) {
    for (const method of ["DELETE", "OPTIONS", path === routes.import ? "GET" : "POST"]) {
      assert.equal((await request(path, { method }, env)).status, 403);
      assert.equal((await request(path, { method, headers: accessHeaders() }, env)).status, 405);
    }
  }
});

test("import requires administrator, same-origin JSON and POST before any subscription fetch", async (t) => {
  const env = unreadableEnv();
  t.mock.method(globalThis, "fetch", () => assert.fail("unauthorized import must not fetch"));
  const headers = { ...accessHeaders(), origin: "https://atlas.example", "content-type": "application/json" };
  const body = JSON.stringify({ text: "https://subscription.example.com/node", nodes: [] });
  for (const [options, expected] of [
    [{ method: "POST", body }, 403],
    [{ method: "POST", body, headers: { ...headers, ...accessHeaders({ email: "member@example.com" }) } }, 403],
    [{ method: "POST", body, headers: { ...headers, origin: "https://foreign.example" } }, 403],
    [{ method: "POST", body, headers: { ...headers, "content-type": "text/plain" } }, 415],
    [{ method: "POST", body: "not-json", headers }, 400],
    [{ method: "POST", body: JSON.stringify({ text: "x".repeat(513 * 1024), nodes: [] }), headers }, 413],
    [{ method: "GET", headers }, 405],
  ]) {
    const response = await request(routes.import, options, env);
    assert.equal(response.status, expected);
    assertSecurityHeaders(response);
  }
});

test("import fetches a subscription and returns a private draft without touching D1", async (t) => {
  const link = "vmess://" + Buffer.from(JSON.stringify({
    ps: "🇺🇸 Test - ISP", add: "node.example.com", port: 443,
    id: "00000000-0000-4000-8000-000000000001", net: "tcp", tls: "tls",
  })).toString("base64");
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    fetches += 1;
    assert.equal(url, "https://subscription.example.com/node");
    assert.equal(options.headers.authorization, undefined);
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.headers["cf-access-jwt-assertion"], undefined);
    return new Response(Buffer.from(link).toString("base64"));
  });
  const response = await request(routes.import, {
    method: "POST",
    headers: { ...accessHeaders(), origin: "https://atlas.example", "content-type": "application/json" },
    body: JSON.stringify({ text: "https://subscription.example.com/node", nodes: [] }),
  }, unreadableEnv());
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);
  const draft = await response.json();
  assert.equal(draft.added, 1);
  assert.equal(draft.nodes.length, 1);
  assert.match(draft.nodes[0].line, /^🇺🇸 Test - ISP = vmess,/);
  assert.equal(fetches, 1);
});

test("audience arrays and normalized administrator emails allow access", async () => {
  const env = createEnv();
  env.ADMIN_EMAILS = `other@example.com, ${ADMIN_EMAIL.toUpperCase()}`;
  const response = await request(routes.state, {
    headers: accessHeaders({ aud: ["other-aud", ACCESS_AUD], email: ` ${ADMIN_EMAIL.toUpperCase()} ` }),
  }, env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).nodes, []);
  assertSecurityHeaders(response);
});

test("missing or invalid management slug fails closed without blocking member subscriptions", async () => {
  for (const slug of [undefined, "", "admin", "A".repeat(32), "../account", "</script>".padEnd(32, "a")]) {
    const env = unreadableEnv();
    env.ADMIN_API_SLUG = slug;
    const admin = await request("/", { headers: accessHeaders() }, env);
    assert.equal(admin.status, 503);
    assert.equal(await admin.text(), "Management API is not configured");
    assert.equal((await request("/", { headers: accessHeaders({ email: "member@example.com" }) }, env)).status, 200);
    for (const path of [routes.state, "/api/admin/pool/state"]) {
      assert.equal((await request(path, { headers: accessHeaders() }, env)).status, 404);
    }
    assert.equal((await request(POOL_SUBSCRIPTION_PATH, {}, env)).status, 401);
  }
});

test("rotating the slug retires the previous route and updates only the admin page", async () => {
  const env = createEnv();
  env.ADMIN_API_SLUG = "fedcba9876543210fedcba9876543210";
  const rotated = getAdminRoutes(env);
  assert.equal((await request(routes.state, { headers: accessHeaders() }, env)).status, 404);
  assert.equal((await request(rotated.state, { headers: accessHeaders() }, env)).status, 200);
  const page = await request("/", { headers: accessHeaders() }, env);
  const body = await page.text();
  assert.ok(body.includes(rotated.state));
  assert.ok(!body.includes(ADMIN_API_SLUG));
  assert.equal((await request(rotated.state, { headers: accessHeaders({ email: "member@example.com" }) }, env)).status, 403);
});

test("legacy pages, APIs, subscriptions and unknown paths return 404 without reading D1", async () => {
  const env = unreadableEnv();
  for (const path of [
    "/admin", "/admin/config", "/admin/certificates", "/atlas", "/atlas/config",
    "/atlasrouter", "/atlasrouter/modules/skip-proxy-lists.sgmodule", "/atlas-router", "/AtlasRouter/subscription", "/AtlasRouter/account",
    "/AtlasRouter/admin", "/AtlasRouter/admin/pool", "/AtlasRouter/account/profile", "/AtlasRouter/account/token",
    "/AtlasRouter/admin/config", "/AtlasRouter/admin/certificates", "/AtlasRouter/admin/pool/state",
    "/AtlasRouter/admin/pool/nodes", "/AtlasRouter/admin/pool/users", "/api/admin", "/api/admin/config",
    "/api/admin/certificates", "/api/admin/pool/state", "/api/admin/pool/nodes", "/api/admin/pool/users",
    "/modules/skip-proxy-lists.sgmodule", "/AtlasRouter/subscription/modules/skip-proxy-lists.sgmodule",
    "/missing", `${routes.state}/`, routes.state.replace(ADMIN_API_SLUG, "a".repeat(32)),
    `${POOL_SUBSCRIPTION_PATH}/modules/missing`, `${POOL_SUBSCRIPTION_PATH}/modules/%E0%A4%A`,
    `${POOL_SUBSCRIPTION_PATH}/rules/TencentOA-Domain.list`, `${POOL_SUBSCRIPTION_PATH}/rules/TencentOA-IP.list`,
    `${POOL_SUBSCRIPTION_PATH}/hosts/TencentOA-Host.conf`,
    `${POOL_SUBSCRIPTION_PATH}/rules/magicrule/surge/Copilot.list`, `${POOL_SUBSCRIPTION_PATH}/rules/magicrule/mihomo/Copilot.yaml`,
    `${POOL_SUBSCRIPTION_PATH}/rules/magicrule/surge/OpenAI.yaml`, `${POOL_SUBSCRIPTION_PATH}/rules/magicrule/mihomo/OpenAI.list`,
    `${POOL_SUBSCRIPTION_PATH}/rules/magicrule/surge/WeChat.list`, `/AtlasRouter-Dev/rules/magicrule/surge/OpenAI.list`,
  ]) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      for (const headers of [{}, accessHeaders()]) {
        const response = await request(`${path}?token=test-only`, { method, headers }, env);
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(response.headers.get("location"), null);
        assertSecurityHeaders(response);
      }
    }
  }
});

test("subscription routes require their own token and only accept GET", async () => {
  const env = unreadableEnv();
  for (const path of [POOL_SUBSCRIPTION_PATH, `${POOL_SUBSCRIPTION_PATH}/modules/tencent-oa.sgmodule`]) {
    for (const query of ["", "?token=invalid", "?admin_token=test-only", "?token=invalid&token=invalid"]) {
      const response = await request(path + query, { headers: accessHeaders() }, env);
      assert.equal(response.status, 401);
      assert.equal(await response.text(), "Unauthorized");
      assertSecurityHeaders(response);
    }
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
      assert.equal((await request(path, { method }, env)).status, 405);
    }
  }
});

test("MagicRule lists are relayed without the subscription token, with ETags and the last valid copy", async (t) => {
  const env = createEnv();
  const headers = { ...accessHeaders(), origin: "https://atlas.example", "content-type": "application/json" };
  const saved = await request(routes.nodes, { method: "PUT", headers, body: JSON.stringify({ revision: 0, nodes: [{ id: "node", line: "🇺🇸 Test ISP = trojan, example.com, 443, password=TEST_ONLY" }] }) }, env);
  assert.equal(saved.status, 200);
  const profile = await (await request(ACCOUNT_PROFILE_PATH, { headers }, env)).json();
  const subscription = new URL(profile.subscriptionUrl);
  const token = subscription.searchParams.get("token");
  const upstream = t.mock.method(globalThis, "fetch", assert.fail);
  const surge = await (await request(`${subscription.pathname}${subscription.search}`, {}, env)).text();
  const relay = magicRuleUrl("OpenAI", "surge", subscription.href);
  assert.equal(relay, "https://atlas.example/AtlasRouter/rules/magicrule/surge/OpenAI.list");
  assert.ok(surge.split("\n").includes(`RULE-SET,${relay},AIProxy,no-resolve,update-interval=21600`));
  assert.doesNotMatch(surge, /pages\.dev/);
  assert.doesNotMatch(surge.split("[Rule]\n")[1], new RegExp(token));
  const config = parseYaml(await (await request(`${subscription.pathname}${subscription.search}&client=clash`, {}, env)).text());
  assert.equal(config["rule-providers"].OpenAI.url, magicRuleUrl("OpenAI", "mihomo", subscription.href));
  assert.equal(config["rule-providers"].OpenAI.interval, 21600);
  assert.ok(Object.values(config["rule-providers"]).every(({ url }) => !url.includes(token)));

  const source = findMagicRuleSource("magicrule/surge/OpenAI.list");
  const list = "DOMAIN-SUFFIX,openai.com\n";
  let available = true;
  upstream.mock.mockImplementation(async (url) => {
    if (!available) return new Response("<html></html>");
    return url === source.manifest
      ? Response.json({ client: "Surge", rule: "OpenAI", artifacts: [{ role: "full", ext: "list", url: "https://magicrule.pages.dev/data/_shared/artifacts/OpenAI_rules_test.list" }] })
      : new Response(list);
  });
  const path = new URL(relay).pathname;
  const fresh = await request(path, {}, env);
  assert.equal(fresh.status, 200);
  assert.equal(await fresh.text(), list);
  assertSecurityHeaders(fresh, "no-cache");
  const etag = fresh.headers.get("etag");
  const cached = await request(path, { headers: { "if-none-match": etag } }, env);
  assert.equal(cached.status, 304);
  assertSecurityHeaders(cached, "no-cache");
  available = false;
  const stored = await request(path, {}, env);
  assert.equal(stored.status, 200);
  assert.equal(await stored.text(), list);
  assert.equal(stored.headers.get("etag"), etag);
  const missing = await request(new URL(magicRuleUrl("OpenAI", "mihomo", subscription.href)).pathname, {}, env);
  assert.equal(missing.status, 502);
  assert.equal(await missing.text(), "Unable to load MagicRule list");
  assertSecurityHeaders(missing);
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "HEAD"]) assert.equal((await request(path, { method }, env)).status, 405);
});

test("unexpected storage errors do not expose internal details", async () => {
  const env = createEnv();
  env.DB.prepare = () => { throw new Error("TEST_ONLY private storage detail"); };
  const response = await request(routes.state, { headers: accessHeaders() }, env);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "Internal Server Error");
  assertSecurityHeaders(response);
});

test("rejects invalid Cloudflare Access JWTs before reading D1", async () => {
  const now = Math.floor(Date.now() / 1000);
  const { privateKey: untrustedPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const unreadableEnv = createEnv();
  unreadableEnv.DB.prepare = () => {
    assert.fail("invalid Access JWTs should not read D1");
  };
  const cases = [
    { token: "not-a-jwt", message: "Invalid Cloudflare Access token" },
    { token: "bad.bad.bad", message: "Invalid Cloudflare Access token" },
    { token: createAccessJwt({}, { alg: "HS256" }), message: "Invalid Cloudflare Access token" },
    { token: createAccessJwt({}, { alg: "none" }), message: "Invalid Cloudflare Access token" },
    { token: createAccessJwt({}, { kid: null }), message: "Invalid Cloudflare Access token" },
    { token: createAccessJwt({ iss: "https://other.cloudflareaccess.com" }), message: "Invalid Cloudflare Access token" },
    { token: createAccessJwt({ aud: "other-aud" }), message: "Invalid Cloudflare Access token" },
    { token: createAccessJwt({ exp: undefined }), message: "Expired Cloudflare Access token" },
    { token: createAccessJwt({ exp: now - 60 }), message: "Expired Cloudflare Access token" },
    { token: createAccessJwt({ nbf: now + 3600 }), message: "Cloudflare Access token is not active" },
    { token: createAccessJwt({}, { kid: "unknown-key" }), message: "Unknown Cloudflare Access signing key" },
    { token: createAccessJwt({}, {}, untrustedPrivateKey), message: "Invalid Cloudflare Access token" },
  ];

  for (const { token, message } of cases) {
    for (const path of [ACCOUNT_PATH, routes.state]) {
      const response = await handleRequest(
        new Request(`https://atlas.example${path}`, {
          headers: { "cf-access-jwt-assertion": token },
        }),
        unreadableEnv,
      );
      assert.equal(response.status, 403);
      assert.equal(await response.text(), message);
    }
  }
});


test("unconfigured Dev routes cannot access either database even with stale bindings", async () => {
  const env = unreadableEnv();
  env.DEV_DB = unreadableEnv().DB;
  env.DEV_SUBSCRIPTION_ORIGIN = "https://retired.example";
  const headers = { ...accessHeaders(), origin: "https://atlas.example", "content-type": "application/json" };
  for (const query of ["?environment=development", "?dev=1"]) {
    for (const [path, method] of [["/", "GET"], [ACCOUNT_PROFILE_PATH, "GET"], [ACCOUNT_TOKEN_PATH, "POST"],
      [routes.state, "GET"], [routes.nodes, "PUT"], [routes.users, "PATCH"], [routes.import, "POST"]]) {
      const response = await request(path + query, { method, headers,
        ...(method === "GET" ? {} : { body: "{}" }) }, env);
      assert.equal(response.status, query.includes("environment") ? 503 : 404, path + query);
      assertSecurityHeaders(response);
    }
  }
  for (const path of ["/AtlasRouter-Dev", "/AtlasRouter-Dev/modules/skip-proxy-lists.sgmodule",
    "/AtlasRouter?dev=1", routes.state.replace("/state", "/reset-production")]) {
    assert.equal((await request(path, { method: "POST", headers, body: "{}" }, env)).status, path === "/AtlasRouter?dev=1" ? 405 : 404);
  }
  for (const query of ["?environment=unknown", "?environment=development&environment=production"]) {
    assert.equal((await request(ACCOUNT_PROFILE_PATH + query, { headers }, env)).status, 400);
  }
  for (const email of [ADMIN_EMAIL, "member@example.com"]) {
    const page = await request("/", { headers: accessHeaders({ email }) }, env);
    assert.equal(page.status, 200);
    assert.doesNotMatch(await page.text(), /environment=development|reset-production|>Dev<|切换到开发环境/);
  }
});

function accessHeaders(payloadOverrides = {}, headerOverrides = {}) {
  return {
    "cf-access-jwt-assertion": createAccessJwt({
      email: ADMIN_EMAIL,
      ...payloadOverrides,
    }, headerOverrides),
  };
}

function createAccessJwt(payloadOverrides = {}, headerOverrides = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    kid: ACCESS_KID,
    typ: "JWT",
    ...headerOverrides,
  };
  const payload = {
    iss: TEAM_DOMAIN,
    aud: ACCESS_AUD,
    email: ADMIN_EMAIL,
    exp: now + 3600,
    nbf: now - 60,
    ...payloadOverrides,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(signingKey);
  return `${signingInput}.${base64Url(signature)}`;
}

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function assertSecurityHeaders(response, cacheControl = "no-store") {
  assert.equal(response.headers.get("cache-control"), cacheControl);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
}
