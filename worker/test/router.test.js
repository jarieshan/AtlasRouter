import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { findMagicRuleSource, magicRuleUrl } from "../src/magic-rules.js";
import { handleRequest } from "../src/index.js";
import { createD1Env } from "../test-helpers/d1.js";
import { readSubscriptionState } from "../src/subscription-db.js";
import { ACCOUNT_PATH, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH, POOL_SUBSCRIPTION_PATH, DEV_SUBSCRIPTION_PATH, getAdminRoutes } from "../src/routes.js";

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
    for (const method of ["DELETE", "OPTIONS", [routes.import, routes.resetProduction].includes(path) ? "GET" : "POST"]) {
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

test("production resetting requires an admin, development target and same-origin POST before reading either database", async () => {
  const env = unreadableEnv();
  env.DEV_DB = { prepare() { assert.fail("must not read development data"); }, batch() { assert.fail("must not write development data"); } };
  env.DEV_SUBSCRIPTION_ORIGIN = "https://develop.atlas.example";
  const headers = { ...accessHeaders(), origin: "https://atlas.example", "content-type": "application/json" };
  const path = `${routes.resetProduction}?environment=development`;
  assert.equal((await request(path.replace("reset-production", "copy-production"), { method: "POST", headers, body: '{"revision":0}' }, env)).status, 404);
  for (const [url, options, status] of [
    [path, { method: "POST", body: '{"revision":0}' }, 403],
    [path, { method: "POST", headers: { ...headers, ...accessHeaders({ email: "member@example.com" }) }, body: '{"revision":0}' }, 403],
    [routes.resetProduction, { method: "POST", headers, body: '{"revision":0}' }, 400],
    [path, { method: "GET", headers }, 405],
    [path, { method: "POST", headers: { ...headers, origin: "https://foreign.example" }, body: '{"revision":0}' }, 403],
    [path, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: '{"revision":0}' }, 415],
    [path, { method: "POST", headers, body: "not-json" }, 400],
    [path, { method: "POST", headers, body: "{}" }, 400],
  ]) assert.equal((await request(url, options, env)).status, status);
  assert.equal((await request(path, { method: "POST", headers, body: '{"revision":0}' }, { ...env, UI_ENABLED: "false" })).status, 400);
});

test("resetting reads only production definitions and replaces only development allocations", async () => {
  const env = createEnv();
  const dev = createD1Env();
  env.DEV_DB = dev.DB;
  env.DEV_SUBSCRIPTION_ORIGIN = "https://develop.atlas.example";
  const headers = { ...accessHeaders(), origin: "https://atlas.example", "content-type": "application/json" };
  const source = [
    { id: "prod", line: "🇺🇸 Production ISP = trojan, production.example.com, 443, password=TEST_ONLY", enabled: true },
    { id: "disabled", line: "🇭🇰 Disabled IDC = trojan, disabled.example.com, 443, password=TEST_ONLY", enabled: false },
  ];
  assert.equal((await request(routes.nodes, { method: "PUT", headers, body: JSON.stringify({ revision: 0, nodes: source }) }, env)).status, 200);
  await request(ACCOUNT_PROFILE_PATH, { headers }, env);
  const account = await (await request(`${ACCOUNT_PROFILE_PATH}?environment=development`, { headers }, env)).json();
  assert.equal((await request(`${routes.nodes}?environment=development`, { method: "PUT", headers, body: JSON.stringify({ revision: 0, nodes: [
    { ...source[0], id: "old-dev", line: source[0].line.replace("production.example.com", "old.example.com"), enabled: false },
    { id: "dev-only", line: "🇸🇬 Dev WARP = trojan, dev.example.com, 443, password=TEST_ONLY", enabled: true },
  ] }) }, env)).status, 200);
  const before = await readSubscriptionState(env);
  const prepare = env.DB.prepare;
  let sourceReads = 0;
  env.DB.prepare = (sql) => {
    assert.equal(sql, "SELECT name, value, enabled FROM nodes ORDER BY sort_order");
    sourceReads += 1;
    return prepare(sql);
  };
  const response = await request(`${routes.resetProduction}?environment=development`, {
    method: "POST", headers, body: '{"revision":1}',
  }, env);
  assert.equal(response.status, 200);
  assertSecurityHeaders(response);
  const reset = await response.json();
  const definitions = (nodes) => nodes.map(({ line, enabled }) => ({ line, enabled }));
  assert.deepEqual(definitions(reset.nodes), definitions(source));
  assert.ok(reset.nodes.every((node) => !["old-dev", "dev-only", "prod", "disabled"].includes(node.id)));
  assert.equal(reset.users.length, 1);
  assert.equal(reset.users[0].status, "active");
  assert.equal(sourceReads, 1);
  env.DB.prepare = prepare;
  assert.deepEqual(await readSubscriptionState(env), before);
  const after = await (await request(`${ACCOUNT_PROFILE_PATH}?environment=development`, { headers }, env)).json();
  assert.equal(after.subscriptionUrl, account.subscriptionUrl);
  const devBeforeRetry = await readSubscriptionState(dev);
  assert.equal((await request(`${routes.resetProduction}?environment=development`, {
    method: "POST", headers, body: '{"revision":1}',
  }, env)).status, 409);
  assert.deepEqual(await readSubscriptionState(dev), devBeforeRetry);
  const retry = await request(`${routes.resetProduction}?environment=development`, {
    method: "POST", headers, body: JSON.stringify({ revision: reset.revision }),
  }, env);
  assert.equal(retry.status, 200);
  const repeated = await retry.json();
  assert.deepEqual(definitions(repeated.nodes), definitions(source));
  assert.equal(repeated.revision, reset.revision + 1);
  assert.ok(repeated.nodes.every((node) => !reset.nodes.some((old) => old.id === node.id)));
  assert.deepEqual(await readSubscriptionState(env), before);
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

test("MagicRule endpoints require a current token and only fetch registered native rule lists", async (t) => {
  const env = createEnv();
  const headers = { ...accessHeaders(), origin: "https://atlas.example", "content-type": "application/json" };
  const saved = await request(routes.nodes, { method: "PUT", headers, body: JSON.stringify({ revision: 0, nodes: [{ id: "node", line: "🇺🇸 Test ISP = trojan, example.com, 443, password=TEST_ONLY" }] }) }, env);
  assert.equal(saved.status, 200);
  const profile = await (await request(ACCOUNT_PROFILE_PATH, { headers }, env)).json();
  const subscription = new URL(profile.subscriptionUrl);
  const config = parseYaml(await (await request(`${subscription.pathname}${subscription.search}&client=clash`, {}, env)).text());
  const token = subscription.searchParams.get("token");
  const ruleUrls = [new URL(magicRuleUrl("Copilot", "surge", subscription, token)), new URL(config["rule-providers"].Copilot.url)];
  const sources = ["surge/Copilot.list", "mihomo/Copilot.yaml"].map((path) => findMagicRuleSource(`magicrule/${path}`));
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    fetches += 1;
    assert.deepEqual(Object.keys(options.headers).sort(), ["accept", "user-agent"]);
    assert.ok(!JSON.stringify([url, options.headers]).includes(token));
    const source = sources.find((source) => source.manifest === url);
    if (source) return Response.json({ client: source.client === "surge" ? "Surge" : "Mihomo", rule: "Copilot", artifacts: [
      { role: "full", ext: source.extension, url: `https://magicrule.pages.dev/data/_shared/artifacts/Copilot_test.${source.extension}` },
    ] });
    if (url === "https://magicrule.pages.dev/data/_shared/artifacts/Copilot_test.list") return new Response("DOMAIN-SUFFIX,example.com\n");
    assert.equal(url, "https://magicrule.pages.dev/data/_shared/artifacts/Copilot_test.yaml");
    return new Response("payload:\n  - DOMAIN-SUFFIX,example.com\n");
  });
  for (const rule of ruleUrls) {
    assert.equal((await request(rule.pathname, { headers: accessHeaders() }, env)).status, 401);
    assert.equal((await request(`${rule.pathname}?token=invalid`, {}, env)).status, 401);
    assert.equal((await request(`${rule.pathname}${rule.search}&token=duplicate`, {}, env)).status, 401);
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) assert.equal((await request(`${rule.pathname}${rule.search}`, { method }, env)).status, 405);
  }
  for (const path of ["/AtlasRouter/rules/magicrule/surge/Unknown.list", "/AtlasRouter/rules/magicrule/mihomo/Copilot.list", "/AtlasRouter/rules/rule-00000000000000000000000000000000.txt"]) {
    assert.equal((await request(path + subscription.search, {}, env)).status, 404);
  }
  assert.equal(fetches, 0);
  for (const [index, rule] of ruleUrls.entries()) {
    const response = await request(`${rule.pathname}${rule.search}`, {}, env);
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
    assert.match(response.headers.get("content-type"), index === 0 ? /text\/plain/ : /application\/yaml/);
    assert.match(await response.text(), /DOMAIN-SUFFIX,example.com/);
  }
  assert.equal(fetches, 4);
  assert.equal((await request(ACCOUNT_TOKEN_PATH, { method: "POST", headers, body: "{}" }, env)).status, 200);
  for (const rule of ruleUrls) assert.equal((await request(`${rule.pathname}${rule.search}`, {}, env)).status, 401);
  assert.equal(fetches, 4);
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


test("production UI manages independent development credentials and links directly to the preview", async (t) => {
  const env = createEnv();
  const development = { ...createEnv(), UI_ENABLED: "false", SUBSCRIPTION_PATH: DEV_SUBSCRIPTION_PATH };
  env.DEV_DB = development.DB;
  env.DEV_SUBSCRIPTION_ORIGIN = "https://develop.atlas.example";
  t.mock.method(globalThis, "fetch", () => assert.fail("UI and subscription generation must not proxy requests"));
  const memberHeaders = accessHeaders({ email: "member@example.com" });
  const mutation = { ...accessHeaders(), origin: "https://atlas.example", "content-type": "application/json" };
  for (const [query, name] of [["", "Production"], ["?environment=development", "Development"]]) {
    const saved = await request(routes.nodes + query, { method: "PUT", headers: mutation,
      body: JSON.stringify({ revision: 0, nodes: [{ id: name, enabled: true,
        line: `🇺🇸 ${name} - ISP = trojan, ${name.toLowerCase()}.example.com, 443, password=TEST_ONLY` }] }) }, env);
    assert.equal(saved.status, 200);
  }
  const prod = await (await request(ACCOUNT_PROFILE_PATH, { headers: memberHeaders }, env)).json();
  const dev = await (await request(`${ACCOUNT_PROFILE_PATH}?environment=development`, { headers: memberHeaders }, env)).json();
  const prodUrl = new URL(prod.subscriptionUrl);
  const devUrl = new URL(dev.subscriptionUrl);
  assert.equal(prodUrl.origin, "https://atlas.example");
  assert.equal(prodUrl.pathname, POOL_SUBSCRIPTION_PATH);
  assert.equal(devUrl.origin, env.DEV_SUBSCRIPTION_ORIGIN);
  assert.equal(devUrl.pathname, DEV_SUBSCRIPTION_PATH);
  assert.deepEqual([...devUrl.searchParams.keys()], ["token"]);
  assert.notEqual(prodUrl.searchParams.get("token"), devUrl.searchParams.get("token"));
  assert.match(prod.groups[0].nodes[0].name, /Production/);
  assert.match(dev.groups[0].nodes[0].name, /Development/);
  const nativeRequest = (url, init) => handleRequest(new Request(url, init), development);
  for (const client of ["surge", "clash"]) {
    const url = new URL(devUrl);
    url.searchParams.set("client", client);
    url.searchParams.set("doh", "1");
    const response = await nativeRequest(url);
    assert.equal(response.status, 200);
    assertSecurityHeaders(response);
    assert.match(response.headers.get("content-disposition"), new RegExp(`AtlasRouter-Dev\\.${client === "clash" ? "yaml" : "conf"}`));
    const body = await response.text();
    assert.match(body, /Development/);
    assert.doesNotMatch(body, /Production/);
    const urls = client === "clash" ? Object.values(parseYaml(body)["rule-providers"]).map((provider) => provider.url)
      .filter((value) => !value.startsWith("https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/"))
      : body.match(/https:\/\/develop\.atlas\.example[^\s]+/g);
    assert.ok(urls.length > 5);
    for (const value of urls) {
      const link = new URL(value.split(",")[0]);
      assert.equal(link.origin, devUrl.origin);
      assert.ok(link.pathname === DEV_SUBSCRIPTION_PATH || link.pathname.startsWith(`${DEV_SUBSCRIPTION_PATH}/`));
      assert.equal(link.searchParams.get("token"), devUrl.searchParams.get("token"));
    }
    if (client === "surge") assert.ok(body.startsWith(`#!MANAGED-CONFIG ${url.toString().replace("&client=surge", "")}`));
  }
  assert.equal((await nativeRequest(`${devUrl.origin}/`)).status, 404);
  assert.equal((await nativeRequest(`${devUrl.origin}/?preview=1`)).status, 404);
  assert.equal((await nativeRequest(`${devUrl.origin}/missing`)).status, 404);
  assert.equal((await nativeRequest(`${devUrl.origin}${POOL_SUBSCRIPTION_PATH}${devUrl.search}`)).status, 404);
  assert.equal((await request(DEV_SUBSCRIPTION_PATH + devUrl.search, {}, env)).status, 404);
  assert.equal((await nativeRequest(`${devUrl.origin}${DEV_SUBSCRIPTION_PATH}`)).status, 401);
  assert.equal((await nativeRequest(devUrl, { method: "POST" })).status, 405);
  assert.equal((await nativeRequest(`${devUrl.origin}${DEV_SUBSCRIPTION_PATH}${prodUrl.search}`)).status, 401);
  assert.equal((await request(POOL_SUBSCRIPTION_PATH + devUrl.search, {}, env)).status, 401);
  const rotated = await request(`${ACCOUNT_TOKEN_PATH}?environment=development`, { method: "POST",
    headers: { ...mutation, ...memberHeaders }, body: "{}" }, env);
  assert.equal(rotated.status, 200);
  assert.equal((await nativeRequest(devUrl)).status, 401);
  assert.equal((await nativeRequest((await rotated.json()).subscriptionUrl)).status, 200);
  assert.equal((await request(POOL_SUBSCRIPTION_PATH + prodUrl.search, {}, env)).status, 200);
  const page = await request("/", { headers: memberHeaders }, env);
  assert.match(await page.text(), /href="\/\?environment=development"/);
  const devPage = await request("/?environment=development", { headers: memberHeaders }, env);
  assert.match(await devPage.text(), /Dev · 开发环境/);
  assert.equal((await request(`${routes.state}?environment=development`, { headers: memberHeaders }, env)).status, 403);
});

test("missing development settings and invalid UI selections cannot fall back to production data", async () => {
  for (const origin of [undefined, "http://develop.atlas.example", "https://user:password@develop.atlas.example", "https://develop.atlas.example/path", "https://atlas.example"]) {
    const env = unreadableEnv();
    env.DEV_DB = createD1Env().DB;
    env.DEV_SUBSCRIPTION_ORIGIN = origin;
    assert.equal((await request(`${ACCOUNT_PROFILE_PATH}?environment=development`, { headers: accessHeaders() }, env)).status, 503);
    assert.equal((await request("/", { headers: accessHeaders() }, env)).status, 200);
  }
  const env = unreadableEnv();
  env.DEV_SUBSCRIPTION_ORIGIN = "https://develop.atlas.example";
  assert.equal((await request(`${ACCOUNT_PROFILE_PATH}?environment=development`, { headers: accessHeaders() }, env)).status, 503);
  for (const query of ["?environment=unknown", "?environment=development&environment=production"]) {
    assert.equal((await request(ACCOUNT_PROFILE_PATH + query, { headers: accessHeaders() }, env)).status, 400);
  }
  assert.equal((await request(`${ACCOUNT_PROFILE_PATH}?environment=development`, {}, env)).status, 403);
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

function assertSecurityHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
}
