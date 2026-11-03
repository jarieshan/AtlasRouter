import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { applyMigrations, migrations } from "../test-helpers/migrations.js";
import { allocateNodes, parsePoolNodes, userGroups } from "../src/node-pool.js";
import { readSubscriptionState } from "../src/subscription-db.js";
import { splitSurgeList, surgeAssignment, surgeOptions } from "../src/surge-format.js";
import { compileBranches } from "../scripts/build-branches.js";
import {
  ACCOUNT_PATH, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH, POOL_SUBSCRIPTION_PATH, getAdminRoutes,
} from "../src/routes.js";

const ADMIN_API_SLUG = "0123456789abcdef0123456789abcdef";
const { state: POOL_STATE_PATH, nodes: POOL_NODES_PATH, users: POOL_USERS_PATH, import: POOL_IMPORT_PATH,
  resetProduction: POOL_RESET_PATH } = getAdminRoutes({ ADMIN_API_SLUG });
const ORIGIN = "https://atlas.example";

const WECHAT_URL = "https://cdn.jsdelivr.net/gh/blackmatrix7/ios_rule_script@master/rule/Surge/WeChat/WeChat.list";
const WECHAT_RULE_ID = `rule-${createHash("sha256").update(`RULE-SET:${WECHAT_URL}`).digest("hex").slice(0, 32)}`;
const DIRECT_URL = "https://magicrule.pages.dev/data/_shared/artifacts/China_rules_25adbc0394103807.list";
const DIRECT_RULE_ID = `rule-${createHash("sha256").update(`RULE-SET:${DIRECT_URL}`).digest("hex").slice(0, 32)}`;
const ICON_BASE = "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/";
const TEAM = "https://test.cloudflareaccess.com";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" };

function orderedSmartMembers(profile, name, expectedWeights) {
  const line = profile.split("\n").find((line) => line.startsWith(`${name} = smart, `));
  assert.ok(line);
  const parts = splitSurgeList(surgeAssignment(line)[1]).slice(1);
  const members = parts.filter((part) => !part.includes("="));
  const options = surgeOptions(parts.filter((part) => part.includes("=")));
  assert.equal(options.get("hidden"), undefined);
  const weights = options.get("policy-priority").split(";").map((entry) => entry.split(":"));
  assert.equal(weights.length, members.length);
  for (const [index, member] of members.entries()) {
    const matches = weights.filter(([pattern]) => new RegExp(pattern).test(member));
    assert.equal(matches.length, 1);
    assert.equal(Number(matches[0][1]), expectedWeights?.[index] ?? index + 1);
  }
  return members;
}

function accessHeaders(subject = "alice", claims = {}) {
  const payload = {
    iss: TEAM, aud: "portal-app",
    sub: subject, email: `${subject}@example.com`, exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "RS256", kid: "test" })}.${encode(payload)}`;
  const signature = createSign("RSA-SHA256").update(body).sign(privateKey).toString("base64url");
  return { "cf-access-jwt-assertion": `${body}.${signature}` };
}

function runtimeOptions(directory, bindings = {}) {
  return convertV4MiniflareOptions({
    name: "atlas-router-tests", modules: true, scriptPath: ".wrangler/test-dist/index.js",
    compatibilityDate: "2026-05-12",
    d1Databases: ["DB"],
    ...(directory ? { resourcePersistencePath: directory } : {}),
    bindings: {
      ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "portal-app",
      ADMIN_EMAILS: "admin@example.com", ADMIN_API_SLUG, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
      PREVIEW_EMAIL_HASHES: createHash("sha256").update("preview@example.com").digest("hex"),
      ...bindings,
    },
  });
}

async function createRuntime(t, bindings) {
  const mf = new Miniflare(runtimeOptions(undefined, bindings));
  t.after(() => mf.dispose());
  await initializeDatabase(mf);
  return mf;
}

async function initializeDatabase(mf) {
  const db = await mf.getD1Database("DB");
  await applyMigrations(db);
}

function request(mf, route, { subject, method = "GET", body, claims, headers = {} } = {}) {
  return mf.dispatchFetch(new URL(route, ORIGIN).toString(), {
    method,
    redirect: "manual",
    headers: {
      ...(subject ? accessHeaders(subject, claims) : {}),
      ...(body === undefined ? {} : { origin: ORIGIN, "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function nodes(count = 3, type = "ISP", flag = "🇺🇸") {
  return Array.from({ length: count }, (_, index) => ({
    id: `${type}-${index + 1}`, enabled: true,
    line: `${flag} Example - ${type} ${index + 1} = trojan, node-${index + 1}.example.com, 443, password=TEST_ONLY`,
  }));
}

async function json(response, status = 200) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

async function save(mf, entries = nodes(), revision = 0) {
  return json(await request(mf, POOL_NODES_PATH, { subject: "admin", method: "PUT", body: { nodes: entries, revision } }));
}

async function account(mf, subject = "alice", claims) {
  return json(await request(mf, ACCOUNT_PROFILE_PATH, { subject, claims }));
}

test("explicit resets replace development nodes from production without syncing users or subsequent edits", async (t) => {
  const common = { modules: true, scriptPath: ".wrangler/test-dist/index.js", compatibilityDate: "2026-05-12" };
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { ...common, name: "production", d1Databases: { DB: "production", DEV_DB: "development" },
      bindings: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "portal-app", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
        ADMIN_EMAILS: "admin@example.com", ADMIN_API_SLUG, DEV_SUBSCRIPTION_ORIGIN: "https://develop.atlas.example" } },
    { ...common, name: "development", d1Databases: { DB: "development" },
      bindings: { UI_ENABLED: "false", SUBSCRIPTION_PATH: "/AtlasRouter-Dev" } },
  ] }));
  t.after(() => mf.dispose());
  const prodDb = await mf.getD1Database("DB", "production");
  const devDb = await mf.getD1Database("DB", "development");
  await applyMigrations(prodDb);
  await applyMigrations(devDb);
  const preview = await mf.getWorker("development");
  const source = [...nodes(2), { id: "disabled", enabled: false,
    line: "🇭🇰 Disabled IDC = trojan, disabled.example.com, 443, password=TEST_ONLY" }];
  const definitions = (nodes) => nodes.map(({ line, enabled }) => ({ line, enabled }));
  await save(mf, source);
  const production = await account(mf, "alice");
  const dev = await json(await request(mf, `${ACCOUNT_PROFILE_PATH}?environment=development`, { subject: "bob" }));
  assert.equal((await preview.fetch(dev.subscriptionUrl)).status, 503);
  const before = await readSubscriptionState({ DB: prodDb });
  const reset = await json(await request(mf, `${POOL_RESET_PATH}?environment=development`, {
    subject: "admin", method: "POST", body: { revision: 0 },
  }));
  assert.deepEqual(definitions(reset.nodes), definitions(source));
  assert.deepEqual(reset.users.map((user) => user.email), ["bob@example.com"]);
  assert.equal(reset.users[0].status, "active");
  assert.ok(reset.nodes.every((node) => !before.state.nodes.some((source) => source.id === node.id)));
  assert.deepEqual(await readSubscriptionState({ DB: prodDb }), before);
  const current = await json(await request(mf, `${ACCOUNT_PROFILE_PATH}?environment=development`, { subject: "bob" }));
  assert.equal(current.subscriptionUrl, dev.subscriptionUrl);
  const surge = await preview.fetch(dev.subscriptionUrl);
  assert.equal(surge.status, 200);
  assert.doesNotMatch(await surge.text(), /disabled\.example\.com/);
  assert.equal((await preview.fetch(`${dev.subscriptionUrl}&client=clash`)).status, 200);
  const productionUrl = new URL(production.subscriptionUrl);
  const wrongToken = new URL(dev.subscriptionUrl);
  wrongToken.searchParams.set("token", productionUrl.searchParams.get("token"));
  assert.equal((await preview.fetch(wrongToken.toString())).status, 401);

  // Manual development edits remain local until the next explicit reset.
  const edited = [...reset.nodes].reverse().map((node) => ({ ...node, enabled: !node.enabled }));
  const draft = [...edited, ...nodes(1, "WARP", "🇸🇬")];
  const saved = await json(await request(mf, `${POOL_NODES_PATH}?environment=development`, {
    subject: "admin", method: "PUT", body: { revision: reset.revision, nodes: draft },
  }));
  const devBeforeReset = await readSubscriptionState({ DB: devDb });
  const changedSource = [
    { ...source[1], line: source[1].line.replace("node-2.example.com", "updated.example.com"), enabled: false },
    { ...source[2], enabled: true },
    { ...source[2], id: "alias", line: source[2].line.replace("Disabled IDC", "Alias IDC"), enabled: true },
  ];
  await save(mf, changedSource, 1);
  const productionBeforeReset = await readSubscriptionState({ DB: prodDb });
  assert.deepEqual(productionBeforeReset.state.users, before.state.users);
  await json(await request(mf, `${ACCOUNT_PROFILE_PATH}?environment=development`, { subject: "bob" }));
  await json(await request(mf, `${POOL_STATE_PATH}?environment=development`, { subject: "admin" }));
  assert.equal((await request(mf, "/?environment=development", { subject: "admin" })).status, 200);
  assert.equal((await preview.fetch(dev.subscriptionUrl)).status, 200);
  assert.deepEqual(await readSubscriptionState({ DB: devDb }), devBeforeReset, "production edits and page reads must never sync nodes");
  const replaced = await json(await request(mf, `${POOL_RESET_PATH}?environment=development`, {
    subject: "admin", method: "POST", body: { revision: saved.revision },
  }));
  assert.deepEqual(definitions(replaced.nodes), definitions(changedSource));
  assert.ok(replaced.nodes.every((node) => !devBeforeReset.state.nodes.some((old) => old.id === node.id)));
  assert.deepEqual(await readSubscriptionState({ DB: prodDb }), productionBeforeReset);
  assert.deepEqual((await readSubscriptionState({ DB: devDb })).state.users, devBeforeReset.state.users);
  assert.equal((await preview.fetch(dev.subscriptionUrl)).status, 200);
  assert.equal((await preview.fetch(`${dev.subscriptionUrl}&client=clash`)).status, 200);

  // An empty production snapshot is also an exact replacement, with no stale allocations.
  await save(mf, [], 2);
  const emptyProduction = await readSubscriptionState({ DB: prodDb });
  const cleared = await json(await request(mf, `${POOL_RESET_PATH}?environment=development`, {
    subject: "admin", method: "POST", body: { revision: replaced.revision },
  }));
  assert.deepEqual(cleared.nodes, []);
  assert.equal(cleared.users[0].status, "pending");
  const emptyDev = await readSubscriptionState({ DB: devDb });
  assert.deepEqual(emptyDev.rows.assignments, []);
  assert.deepEqual(emptyDev.state.users, devBeforeReset.state.users);
  assert.deepEqual(await readSubscriptionState({ DB: prodDb }), emptyProduction);
  assert.equal((await preview.fetch(dev.subscriptionUrl)).status, 503);
});

test("native preview consumes links from the production UI with separate D1 data and no preview UI", async (t) => {
  const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
  assert.notEqual(config.d1_databases[0].database_id, config.previews.d1_databases[0].database_id);
  assert.equal(config.d1_databases.find((db) => db.binding === "DEV_DB").database_id, config.previews.d1_databases[0].database_id);
  const common = { modules: true, scriptPath: ".wrangler/test-dist/index.js", compatibilityDate: "2026-05-12" };
  const devOrigin = "https://develop.atlas.example";
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { ...common, name: "production", d1Databases: { DB: "production", DEV_DB: "development" },
      bindings: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "portal-app", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
        ADMIN_EMAILS: "admin@example.com", ADMIN_API_SLUG, DEV_SUBSCRIPTION_ORIGIN: devOrigin } },
    { ...common, name: "development", d1Databases: { DB: "development" }, bindings: config.previews.vars },
  ] }));
  t.after(() => mf.dispose());
  const prodDb = await mf.getD1Database("DB", "production");
  await applyMigrations(prodDb);
  await applyMigrations(await mf.getD1Database("DB", "development"));
  const preview = await mf.getWorker("development");
  await save(mf);
  const production = await account(mf);
  const before = await readSubscriptionState({ DB: prodDb });
  await json(await request(mf, `${POOL_NODES_PATH}?environment=development`, { subject: "admin", method: "PUT",
    body: { revision: 0, nodes: [...nodes(5, "WARP"), ...nodes(1, "IDC", "🇭🇰")] } }));
  const dev = await json(await request(mf, `${ACCOUNT_PROFILE_PATH}?environment=development`, { subject: "alice" }));
  const url = new URL(dev.subscriptionUrl);
  assert.equal(url.origin, devOrigin);
  assert.equal(url.pathname, "/AtlasRouter-Dev");
  assert.notEqual(url.searchParams.get("token"), new URL(production.subscriptionUrl).searchParams.get("token"));
  const response = await preview.fetch(dev.subscriptionUrl);
  assert.equal(response.status, 200);
  const surge = await response.text();
  orderedSmartMembers(surge, "🇺🇸USA-WARP", [1, 10, 100, 1000, 10000]);
  assert.doesNotMatch(surge, /Example - ISP/);
  assert.ok(surge.split("\n").includes(`DoH Proxy = smart, 🇭🇰 Example - IDC 1, icon-url=${ICON_BASE}Server.png`));
  assert.doesNotMatch(surge.split("[Proxy Group]\n")[1].split("[Rule]\n")[0], /hidden\s*=/i);
  const moduleUrl = surge.match(/https:\/\/develop\.atlas\.example\/AtlasRouter-Dev\/modules\/[^\s]+/)[0];
  assert.equal((await preview.fetch(moduleUrl)).status, 200);
  const clashResponse = await preview.fetch(`${dev.subscriptionUrl}&client=clash`);
  assert.equal(clashResponse.status, 200);
  const clash = parseYaml(await clashResponse.text());
  assert.ok(clash["proxy-groups"].every((group) => group.hidden === undefined));
  assert.deepEqual(clash["proxy-groups"].find(({ name }) => name === "DoH Proxy").proxies, ["🇭🇰 Example - IDC 1"]);
  assert.equal(clash["proxy-groups"].find(({ name }) => name === "DoH Proxy").icon, `${ICON_BASE}Server.png`);
  assert.ok(Object.values(clash["rule-providers"]).every(({ url }) => url.startsWith(`${devOrigin}/AtlasRouter-Dev/rules/`)));
  assert.equal((await preview.fetch(`${devOrigin}/`)).status, 404);
  assert.equal((await preview.fetch(`${devOrigin}/missing`)).status, 404);
  assert.equal((await preview.fetch(`${devOrigin}/AtlasRouter-Dev`)).status, 401);
  assert.equal((await preview.fetch(`${devOrigin}/AtlasRouter${url.search}`)).status, 404);
  assert.equal((await request(mf, `/AtlasRouter-Dev${url.search}`)).status, 404);
  assert.deepEqual(await readSubscriptionState({ DB: prodDb }), before);
});

test("development uses independent identities, tokens and node data with geometric Smart weights", async (t) => {
  const production = await createRuntime(t);
  const development = await createRuntime(t, { ACCESS_AUD: "development-app", SMART_PRIORITY_SCHEME: "geometric-10" });
  await save(production);
  const productionAccount = await account(production);
  const before = await readSubscriptionState({ DB: await production.getD1Database("DB") });
  const claims = { aud: "development-app" };
  assert.equal((await request(development, ACCOUNT_PROFILE_PATH, { subject: "alice" })).status, 403);
  assert.equal((await request(production, ACCOUNT_PROFILE_PATH, { subject: "alice", claims })).status, 403);
  const empty = await json(await request(development, POOL_STATE_PATH, { subject: "admin", claims }));
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.users.length, 0);
  const developmentAccount = await account(development, "alice", claims);
  assert.equal((await request(development, developmentAccount.subscriptionUrl)).status, 503);
  await json(await request(development, POOL_NODES_PATH, { subject: "admin", claims, method: "PUT", body: { revision: 0, nodes: nodes(5) } }));
  assert.notEqual(developmentAccount.subscriptionUrl, productionAccount.subscriptionUrl);
  assert.equal((await request(development, productionAccount.subscriptionUrl)).status, 401);
  assert.equal((await request(production, developmentAccount.subscriptionUrl)).status, 401);
  const surgeResponse = await request(development, developmentAccount.subscriptionUrl);
  assert.equal(surgeResponse.status, 200);
  const surge = await surgeResponse.text();
  const members = orderedSmartMembers(surge, "🇺🇸USA-ISP", [1, 10, 100, 1000, 10000]);
  const clashResponse = await request(development, `${developmentAccount.subscriptionUrl}&client=clash`);
  assert.equal(clashResponse.status, 200);
  const clash = parseYaml(await clashResponse.text());
  const group = clash["proxy-groups"].find(({ name }) => name === "🇺🇸USA-ISP");
  assert.equal(group.type, "fallback");
  assert.deepEqual(group.proxies, members);
  assert.equal(group["policy-priority"], undefined);
  const productionMembers = orderedSmartMembers(await (await request(production, productionAccount.subscriptionUrl)).text(), "🇺🇸USA-ISP");
  assert.equal(productionMembers.length, 3);
  assert.deepEqual(await readSubscriptionState({ DB: await production.getD1Database("DB") }), before);
});

test("one Worker preserves dev across real subscription, module, rule and account links", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "atlas-one-worker-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = await compileBranches({ master: path.resolve(".wrangler/test-dist/index.js"),
    develop: path.resolve(".wrangler/test-dist/index.js") }, directory);
  const devSlug = "fedcba9876543210fedcba9876543210";
  const devRoutes = getAdminRoutes({ ADMIN_API_SLUG: devSlug });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "single-router", modules: true,
    script: await readFile(script, "utf8"), compatibilityDate: "2026-05-12",
    d1Databases: { DB: "production", DEV_DB: "development" },
    bindings: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "portal-app", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
      ADMIN_EMAILS: "admin@example.com", ADMIN_API_SLUG,
      DEV_ADMIN_EMAILS: "devadmin@example.com", DEV_ADMIN_API_SLUG: devSlug, DEV_SMART_PRIORITY_SCHEME: "geometric-3" },
  }));
  t.after(() => mf.dispose());
  const productionDb = await mf.getD1Database("DB");
  await applyMigrations(productionDb);
  await applyMigrations(await mf.getD1Database("DEV_DB"));
  await save(mf);
  const production = await account(mf);
  const before = await readSubscriptionState({ DB: productionDb });
  assert.equal((await request(mf, `${devRoutes.state}?dev=1`, { subject: "admin" })).status, 403);
  assert.equal((await request(mf, POOL_STATE_PATH, { subject: "devadmin" })).status, 403);
  await json(await request(mf, `${devRoutes.nodes}?dev=1`, { subject: "devadmin", method: "PUT",
    body: { revision: 0, nodes: nodes(5) } }));
  const development = await json(await request(mf, `${ACCOUNT_PROFILE_PATH}?dev=1`, { subject: "alice" }));
  const developmentUrl = new URL(development.subscriptionUrl);
  assert.equal(developmentUrl.searchParams.get("dev"), "1");
  assert.equal(new URL(production.subscriptionUrl).searchParams.has("dev"), false);
  assert.equal((await request(mf, `${production.subscriptionUrl}&dev=1`)).status, 401);
  const noSelector = new URL(development.subscriptionUrl);
  noSelector.searchParams.delete("dev");
  assert.equal((await request(mf, noSelector.toString())).status, 401);
  const surge = await (await request(mf, development.subscriptionUrl)).text();
  orderedSmartMembers(surge, "🇺🇸USA-ISP", [1, 3, 9, 27, 81]);
  const urls = [...surge.matchAll(/https:\/\/atlas\.example\/AtlasRouter[^\s,"]+/g)].map(([url]) => new URL(url));
  assert.ok(urls.length > 3);
  assert.ok(urls.every((url) => url.searchParams.get("dev") === "1"));
  const module = urls.find((url) => url.pathname.includes("/modules/"));
  assert.ok(module);
  assert.equal((await request(mf, module.toString())).status, 200);
  const clash = parseYaml(await (await request(mf, `${development.subscriptionUrl}&client=clash`)).text());
  const providers = Object.values(clash["rule-providers"]);
  assert.ok(providers.some((provider) => provider.format === "yaml"));
  assert.ok(providers.every((provider) => new URL(provider.url).searchParams.get("dev") === "1"));
  assert.equal((await request(mf, `${POOL_SUBSCRIPTION_PATH}?dev=1`)).status, 401);
  assert.equal((await request(mf, "/missing?dev=1")).status, 404);
  assert.deepEqual(await readSubscriptionState({ DB: productionDb }), before);
});

test("Access guards member and admin pages, validates claims, methods and paths", async (t) => {
  const mf = await createRuntime(t);
  for (const route of [ACCOUNT_PATH, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH, POOL_STATE_PATH, POOL_NODES_PATH, POOL_USERS_PATH, POOL_IMPORT_PATH]) {
    assert.equal((await request(mf, route)).status, 403);
    assert.equal((await request(mf, route, { headers: { "cf-access-authenticated-user-email": "admin@example.com", authorization: "Bearer token" } })).status, 403);
  }
  for (const claims of [{ email: "" }, { email: [] }, { aud: "wrong-app" }, { iss: "https://wrong.example" }, { exp: 1 }]) {
    assert.equal((await request(mf, ACCOUNT_PROFILE_PATH, { subject: "alice", claims })).status, 403);
  }
  for (const route of [POOL_STATE_PATH, POOL_NODES_PATH, POOL_USERS_PATH, POOL_IMPORT_PATH]) {
    assert.equal((await request(mf, route, { subject: "alice" })).status, 403);
  }
  assert.equal((await request(mf, ACCOUNT_PATH, { subject: "alice" })).status, 200);
  assert.equal((await request(mf, ACCOUNT_PROFILE_PATH, { subject: "alice", method: "DELETE" })).status, 405);
  assert.equal((await request(mf, POOL_NODES_PATH, { subject: "admin", method: "POST" })).status, 405);
  for (const route of ["/missing", `${POOL_STATE_PATH}/missing`, `${POOL_SUBSCRIPTION_PATH}/modules/missing`, `${POOL_SUBSCRIPTION_PATH}/modules/%E0%A4%A`]) {
    assert.equal((await request(mf, route)).status, 404);
  }
  assert.equal((await request(mf, POOL_SUBSCRIPTION_PATH)).status, 401);
  assert.equal((await request(mf, `${POOL_SUBSCRIPTION_PATH}?token=invalid`)).status, 401);
  assert.equal((await request(mf, `${POOL_SUBSCRIPTION_PATH}?token=ar_${"0".repeat(64)}`)).status, 401);
  const state = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  assert.equal(state.users.length, 0, "unauthorized requests and page shells must not create users");
});

test("domain root renders member or admin content from the verified email", async (t) => {
  const mf = await createRuntime(t);
  const member = await request(mf, "/", { subject: "alice" });
  const memberHtml = await member.text();
  assert.equal(member.status, 200);
  assert.match(memberHtml, /id="account-panel"/);
  assert.ok(memberHtml.includes('"/api/account/profile"'));
  assert.ok(memberHtml.includes('"/api/account/token"'));
  assert.doesNotMatch(memberHtml, /id="pool-panel"|id="inventory"|\/admin\/pool\/state/);

  const admin = await request(mf, "/", { subject: "admin" });
  const adminHtml = await admin.text();
  assert.equal(admin.status, 200);
  assert.match(adminHtml, /id="account-panel"/);
  assert.match(adminHtml, /id="pool-panel"/);
  assert.match(adminHtml, /id="inventory"/);
  for (const path of [POOL_STATE_PATH, POOL_NODES_PATH, POOL_USERS_PATH]) {
    assert.ok(adminHtml.includes(JSON.stringify(path)));
  }
  assert.doesNotMatch(memberHtml, new RegExp(ADMIN_API_SLUG));
  assert.doesNotMatch(adminHtml, /href="\/admin"|原有手动配置/);
  assert.doesNotMatch(adminHtml, /\/AtlasRouter\/(?:account|admin)/);
  assert.equal(admin.headers.get("cache-control"), "no-store");

  const forgedRole = await request(mf, `${ACCOUNT_PATH}?role=admin&email=admin@example.com`, {
    subject: "alice", headers: { "cf-access-authenticated-user-email": "admin@example.com", "x-role": "admin" },
  });
  assert.doesNotMatch(await forgedRole.text(), /id="pool-panel"/);
  const normalizedAdmin = await request(mf, ACCOUNT_PATH, { subject: "another-subject", claims: { email: " ADMIN@EXAMPLE.COM " } });
  assert.match(await normalizedAdmin.text(), /id="pool-panel"/);

  // One Access application session works for both personal and management APIs.
  const adminProfile = await account(mf, "admin");
  assert.equal(adminProfile.email, "admin@example.com");
  const inventory = await save(mf);
  assert.ok(inventory.users.some((user) => user.id === adminProfile.id));
  assert.equal((await request(mf, adminProfile.subscriptionUrl)).status, 200);
  assert.equal((await request(mf, POOL_NODES_PATH, { subject: "alice", method: "PUT", body: { revision: 1, nodes: [] } })).status, 403);
  for (const aud of ["user-app", "admin-app"]) {
    assert.equal((await request(mf, ACCOUNT_PATH, { subject: "admin", claims: { aud } })).status, 403);
  }
  assert.equal((await request(mf, "/", { subject: "alice", method: "POST" })).status, 405);
});

test("preview page visits leave production users, allocations and counters unchanged", async (t) => {
  const mf = await createRuntime(t);
  await save(mf);
  const real = await account(mf, "alice");
  const before = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  for (const subject of ["preview", "admin", "preview"]) {
    const response = await request(mf, "/?preview=1", { subject });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /页面预览/);
    assert.doesNotMatch(body, /id="pool-panel"/);
    assert.ok(!body.includes(ADMIN_API_SLUG));
  }
  assert.deepEqual(await json(await request(mf, POOL_STATE_PATH, { subject: "admin" })), before);
  assert.equal((await request(mf, `${POOL_SUBSCRIPTION_PATH}?token=preview`)).status, 401);
  assert.equal((await request(mf, real.subscriptionUrl)).status, 200);
});

test("preview identities read current database nodes without changing any stored state", async (t) => {
  const mf = await createRuntime(t);
  const entries = [...nodes(), ...nodes(1, "WARP", "🇸🇬")];
  entries[2].enabled = false;
  await save(mf, entries);
  await account(mf, "alice");
  const env = { DB: await mf.getD1Database("DB") };
  const snapshot = await readSubscriptionState(env);
  const before = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  const page = await request(mf, "/", { subject: "preview" });
  const body = await page.text();
  assert.match(body, /只读展示当前启用的真实节点/);
  assert.match(body, /🇺🇸 Example - ISP 1/);
  assert.doesNotMatch(body, /Example - ISP 3|TEST_ONLY|node-1\.example\.com/);
  const expected = before.nodes.filter((node) => node.enabled).map(({ id, name }) => ({ id, name }));
  const profiles = await Promise.all(Array.from({ length: 8 }, () => account(mf, "preview")));
  for (const profile of profiles) {
    assert.equal(new URL(profile.subscriptionUrl).hostname, "preview.invalid");
    assert.equal(profile.nodeSource, "database");
    assert.deepEqual(profile.groups.flatMap((group) => group.nodes), expected);
  }
  const rotated = await json(await request(mf, ACCOUNT_TOKEN_PATH, { subject: "preview", method: "POST", body: {} }));
  assert.deepEqual(rotated, profiles[0]);
  assert.deepEqual(await json(await request(mf, POOL_STATE_PATH, { subject: "admin" })), before);
  assert.equal((await request(mf, POOL_STATE_PATH, { subject: "preview" })).status, 403);
  assert.deepEqual(await readSubscriptionState(env), snapshot);

  entries[0].line = entries[0].line.replace("Example", "Renamed");
  entries[1].enabled = false;
  await save(mf, entries, before.revision);
  const updated = await readSubscriptionState(env);
  const refreshed = await account(mf, "preview");
  assert.deepEqual(refreshed.groups.flatMap((group) => group.nodes), [
    { id: "ISP-1", name: "🇺🇸 Renamed - ISP 1" },
    { id: "WARP-1", name: "🇸🇬 Example - WARP 1" },
  ]);
  const reloaded = await request(mf, "/", { subject: "preview" });
  assert.match(await reloaded.text(), /🇺🇸 Renamed - ISP 1/);
  assert.deepEqual(await readSubscriptionState(env), updated);
});

test("simultaneous first logins receive stable unique accounts and exclusive primaries", async (t) => {
  const mf = await createRuntime(t);
  await save(mf);
  const profiles = await Promise.all(["alice", "bob", "carol", "alice"].map((subject) => account(mf, subject)));
  assert.equal(profiles[0].id, profiles[3].id);
  assert.equal(profiles[0].subscriptionUrl, profiles[3].subscriptionUrl);
  assert.equal(new Set(profiles.slice(0, 3).map((profile) => profile.subscriptionUrl)).size, 3);
  const orders = profiles.slice(0, 3).map((profile) => profile.groups[0].nodes.map((node) => node.id));
  for (let position = 0; position < 3; position += 1) assert.equal(new Set(orders.map((order) => order[position])).size, 3);
  const state = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  assert.equal(state.users.length, 3);
  assert.ok(state.nodes.every((node) => node.assignmentCount === 1));
  assert.doesNotMatch(JSON.stringify(state.users), /subscribeToken|subscriptionUrl|TEST_ONLY/);
  assert.doesNotMatch(JSON.stringify(profiles), /bob@example.com.*alice@example.com.*TEST_ONLY|ownerId|TEST_ONLY|node-1.example.com/);
  for (const profile of profiles.slice(0, 3)) {
    assert.equal(profile.status, "active");
    assert.equal(new URL(profile.subscriptionUrl).pathname, "/AtlasRouter");
    const response = await request(mf, profile.subscriptionUrl);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const config = await response.text();
    assert.deepEqual(orderedSmartMembers(config, "🇺🇸USA-ISP"), profile.groups[0].nodes.map((node) => node.name));
    assert.match(config, /^#!MANAGED-CONFIG https:\/\/atlas.example\/AtlasRouter\?token=/);
    assert.match(config, /^FINAL,Proxy,dns-failed$/m);
    const moduleUrl = config.match(/https:\/\/[^\s]+\/modules\/tencent-oa.sgmodule\?token=[^\s]+/)[0];
    const module = await request(mf, moduleUrl);
    assert.equal(module.status, 200);
    assert.match(await module.text(), /#!name=Tencent OA Compatibility/);
  }
});

test("portal, inventory and both subscription formats share balanced backup priorities", async (t) => {
  const mf = await createRuntime(t);
  await save(mf);
  const subjects = Array.from({ length: 30 }, (_, index) => `member-${index}`);
  const profiles = await Promise.all(subjects.map((subject) => account(mf, subject)));
  const before = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  assert.ok(before.nodes.every((node) => node.ownerIds.length === 10 && node.assignmentCount === 10));
  const orders = await Promise.all(profiles.map(async (profile) => {
    const group = profile.groups[0];
    assert.deepEqual(before.users.find((user) => user.id === profile.id).groups, profile.groups);
    const response = await request(mf, profile.subscriptionUrl);
    assert.equal(response.status, 200);
    const config = await response.text();
    const members = orderedSmartMembers(config, group.group);
    assert.deepEqual(members, group.nodes.map((node) => node.name));
    const clashResponse = await request(mf, `${profile.subscriptionUrl}&client=clash`);
    assert.equal(clashResponse.status, 200);
    const clash = parseYaml(await clashResponse.text())["proxy-groups"].find(({ name }) => name === group.group);
    assert.equal(clash.type, "fallback");
    assert.deepEqual(clash.proxies, members);
    return clash.proxies;
  }));
  for (const failed of before.nodes) {
    const selected = orders.map((order) => order.find((name) => name !== failed.name));
    const counts = before.nodes.filter((node) => node.id !== failed.id).map((node) => selected.filter((name) => name === node.name).length);
    assert.deepEqual(counts, [15, 15]);
  }
  assert.deepEqual(await account(mf, subjects[0]), profiles[0]);
  assert.deepEqual(await json(await request(mf, POOL_STATE_PATH, { subject: "admin" })), before);
});

test("only current subscription and module URLs accept tokens", async (t) => {
  const mf = await createRuntime(t);
  await save(mf);
  const profile = await account(mf);
  const token = new URL(profile.subscriptionUrl).searchParams.get("token");
  const modulePath = `${POOL_SUBSCRIPTION_PATH}/modules/tencent-oa.sgmodule`;
  for (const route of [POOL_SUBSCRIPTION_PATH, modulePath]) {
    assert.equal((await request(mf, `${route}?token=${token}`)).status, 200);
    assert.equal((await request(mf, route, { subject: "alice" })).status, 401);
    assert.equal((await request(mf, `${route}?token=${token}&token=${token}`)).status, 401);
    assert.equal((await request(mf, `${route}?token=${token}`, { method: "POST" })).status, 405);
  }
  for (const route of ["/atlasrouter", "/atlasrouter/modules/skip-proxy-lists.sgmodule", "/atlas-router", "/AtlasRouter/subscription", "/modules/skip-proxy-lists.sgmodule", "/AtlasRouter/subscription/modules/skip-proxy-lists.sgmodule", "/AtlasRouter/rules/magicrule/surge/WeChat.list", "/AtlasRouter/rules/magicrule/mihomo/WeChat.yaml"]) {
    assert.equal((await request(mf, `${route}?token=${token}`, { subject: "admin" })).status, 404);
  }
  const wechatPath = `${POOL_SUBSCRIPTION_PATH}/rules/${WECHAT_RULE_ID}.txt`;
  for (const query of ["", "?token=invalid", `?token=${token}&token=${token}`]) {
    assert.equal((await request(mf, wechatPath + query, { subject: "alice" })).status, 401);
  }
  await json(await request(mf, ACCOUNT_TOKEN_PATH, { subject: "alice", method: "POST", body: {} }));
  for (const route of [POOL_SUBSCRIPTION_PATH, modulePath, wechatPath]) {
    assert.equal((await request(mf, `${route}?token=${token}`)).status, 401);
  }
});

test("Surge and Clash options share a token and allocation, enable DoH and reject invalid options", async (t) => {
  const mf = await createRuntime(t);
  await save(mf, [...nodes(), ...nodes(1, "IDC", "🇭🇰")]);
  const profile = await account(mf);
  const before = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  for (const client of ["surge", "clash"]) {
    for (const doh of ["0", "1"]) {
      const response = await request(mf, `${profile.subscriptionUrl}&client=${client}&doh=${doh}`);
      assert.equal(response.status, 200);
      const text = await response.text();
      if (client === "clash") {
        assert.match(response.headers.get("content-type"), /application\/yaml/);
        const config = parseYaml(text);
        assert.equal(config["x-clash-block-quic"], "all-proxy");
        assert.equal(config.proxies.length, 4);
        for (const group of profile.groups) assert.deepEqual(config["proxy-groups"].find(({ name }) => name === group.group).proxies, group.nodes.map(({ name }) => name));
        assert.equal(config.dns.nameserver.every((server) => server.startsWith("https://")), doh === "1");
        assert.deepEqual(config.dns.nameserver, doh === "1" ? ["https://cloudflare-dns.com/dns-query#RULES", "https://dns.google/dns-query#RULES"] : ["223.5.5.5", "119.29.29.29", "system"]);
        assert.deepEqual(config.dns["proxy-server-nameserver"], ["223.5.5.5", "119.29.29.29", "system"]);
        assert.deepEqual(config.dns["nameserver-policy"], {
          "zslab.ai": ["223.5.5.5", "119.29.29.29"], ".zslab.ai": ["223.5.5.5", "119.29.29.29"],
          "dns.alidns.com": ["223.5.5.5", "119.29.29.29"], "doh.pub": ["223.5.5.5", "119.29.29.29"],
          [`rule-set:${DIRECT_RULE_ID}`]: doh === "1"
            ? ["https://dns.alidns.com/dns-query#RULES", "https://doh.pub/dns-query#RULES"]
            : ["223.5.5.5", "119.29.29.29"],
        });
        assert.equal(config["rule-providers"][DIRECT_RULE_ID].url, `${profile.subscriptionUrl.split("?")[0]}/rules/${DIRECT_RULE_ID}.txt${new URL(profile.subscriptionUrl).search}`);
        const auto = config["proxy-groups"].find(({ name }) => name === "Auto");
        assert.equal(auto.type, "url-test");
        assert.equal(auto.icon, `${ICON_BASE}Auto.png`);
        assert.deepEqual(auto.proxies, config.proxies.map(({ name }) => name));
        assert.deepEqual(config["proxy-groups"].find(({ name }) => name === "Proxy").proxies, ["🇺🇸USA-ISP", "🇭🇰HK-IDC", "Auto", "DIRECT"]);
        const dohProxy = config["proxy-groups"].find(({ name }) => name === "DoH Proxy");
        assert.equal(dohProxy.type, "url-test");
        assert.equal(dohProxy.icon, `${ICON_BASE}Server.png`);
        assert.equal(dohProxy.hidden, true);
        assert.deepEqual(dohProxy.proxies, ["🇭🇰 Example - IDC 1"]);
        for (const hostname of ["cloudflare-dns.com", "dns.google"]) assert.ok(config.rules.includes(`DOMAIN,${hostname},DoH Proxy`));
        for (const hostname of ["dns.alidns.com", "doh.pub"]) assert.ok(config.rules.includes(`DOMAIN,${hostname},DIRECT`));
        assert.deepEqual(config.tun?.["dns-hijack"], ["8.8.8.8:53", "8.8.4.4:53"]);
        assert.equal(config.rules.at(-1), "MATCH,Proxy");
        for (const group of profile.groups) assert.equal(config["proxy-groups"].find(({ name }) => name === group.group).hidden, undefined);
        assert.ok(!config["proxy-groups"].some((group) => group.name === "AppleProxy"));
        assert.deepEqual(config["proxy-groups"].find((group) => group.name === "AppleDirect").proxies, ["DIRECT"]);
        assert.equal(config["proxy-groups"].find((group) => group.name === "AppleDirect").hidden, true);
        const icloud = config["proxy-groups"].find((group) => group.name === "iCloud");
        assert.deepEqual(icloud.proxies, ["DIRECT", "🇭🇰HK-IDC", "🇺🇸USA-ISP"]);
        assert.ok(!icloud.hidden);
        const wechat = config["proxy-groups"].find((group) => group.name === "WeChat");
        assert.deepEqual(wechat.proxies, ["DIRECT", "🇭🇰HK-IDC", "🇺🇸USA-ISP"]);
        assert.ok(!wechat.hidden);
        assert.equal(wechat.icon, `${ICON_BASE}WeChat.png`);
        assert.equal(config["proxy-groups"].find((group) => group.name === "AppleDirect").icon, `${ICON_BASE}Apple.png`);
        assert.ok(config.rules.includes(`RULE-SET,${WECHAT_RULE_ID},WeChat,no-resolve`));
        const wechatProvider = config["rule-providers"][WECHAT_RULE_ID];
        assert.equal(wechatProvider.format, "text");
        const wechatProviderUrl = new URL(wechatProvider.url);
        assert.equal(wechatProviderUrl.origin, ORIGIN);
        assert.equal(wechatProviderUrl.pathname, `/AtlasRouter/rules/${WECHAT_RULE_ID}.txt`);
        assert.equal(wechatProviderUrl.search, new URL(profile.subscriptionUrl).search);
        for (const group of config["proxy-groups"].filter((group) => group.type === "select")) assert.ok(!group.proxies.includes("REJECT"), group.name);
        const provider = new URL(config["rule-providers"].iCloud.url);
        assert.equal(provider.pathname, "/AtlasRouter/rules/magicrule/mihomo/iCloud.yaml");
        assert.equal(provider.search, new URL(profile.subscriptionUrl).search);
        const youtube = config["proxy-groups"].find((group) => group.name === "YouTube");
        assert.deepEqual(youtube.proxies, ["🇭🇰HK-IDC", "🇺🇸USA-ISP"]);
        assert.ok(!youtube.hidden);
        assert.equal(youtube.icon, `${ICON_BASE}YouTube.png`);
        assert.ok(config.rules.includes("RULE-SET,YouTube,YouTube,no-resolve"));
        const youtubeProvider = new URL(config["rule-providers"].YouTube.url);
        assert.equal(youtubeProvider.pathname, "/AtlasRouter/rules/magicrule/mihomo/YouTube.yaml");
        assert.equal(youtubeProvider.search, new URL(profile.subscriptionUrl).search);
      } else {
        assert.match(response.headers.get("content-type"), /text\/plain/);
        assert.equal(/^encrypted-dns-server =/m.test(text), doh === "1");
        assert.equal(/^encrypted-dns-follow-outbound-mode = true$/m.test(text), doh === "1");
        assert.ok(text.split("\n").includes(`Auto = smart, include-all-proxies=true, icon-url=${ICON_BASE}Auto.png`));
        assert.match(text, /^Proxy = select, 🇺🇸USA-ISP, 🇭🇰HK-IDC, Auto, DIRECT, /m);
        assert.ok(text.split("\n").includes(`DoH Proxy = smart, 🇭🇰 Example - IDC 1, icon-url=${ICON_BASE}Server.png, hidden=true`));
        assert.doesNotMatch(text, /^PROTOCOL,DOH,/m);
        assert.match(text, /\[Host\]\nzslab\.ai = server:223\.5\.5\.5, 119\.29\.29\.29\n\*\.zslab\.ai = server:223\.5\.5\.5, 119\.29\.29\.29\n/);
        const directDns = doh === "1" ? "https://dns.alidns.com/dns-query, https://doh.pub/dns-query" : "223.5.5.5, 119.29.29.29";
        assert.ok(text.split("\n").includes(`RULE-SET:${DIRECT_URL} = server:${directDns}`));
        for (const hostname of ["cloudflare-dns.com", "dns.google"]) assert.ok(text.includes(`DOMAIN,${hostname},DoH Proxy\n`));
        for (const hostname of ["dns.alidns.com", "doh.pub"]) {
          const rule = `DOMAIN,${hostname},DIRECT\n`;
          assert.ok(text.includes(rule));
          const hosts = text.split("[Host]\n")[1].split("[Proxy]\n")[0];
          const mapping = `${hostname} = server:223.5.5.5, 119.29.29.29`;
          assert.ok(hosts.split("\n").includes(mapping));
          assert.ok(hosts.indexOf(mapping) < hosts.indexOf(`RULE-SET:${DIRECT_URL}`));
        }
        assert.deepEqual(text.match(/^hijack-dns\s*=.*$/gm), ["hijack-dns = 8.8.8.8:53, 8.8.4.4:53"]);
        const managed = new URL(text.match(/^#!MANAGED-CONFIG (\S+)/)[1]);
        assert.equal(managed.searchParams.get("doh"), doh === "1" ? "1" : null);
        assert.ok(text.split("\n").includes(`iCloud = select, DIRECT, 🇭🇰HK-IDC, 🇺🇸USA-ISP, icon-url=${ICON_BASE}iCloud.png`));
        assert.ok(text.split("\n").includes(`WeChat = select, DIRECT, 🇭🇰HK-IDC, 🇺🇸USA-ISP, icon-url=${ICON_BASE}WeChat.png`));
        assert.ok(text.split("\n").includes(`YouTube = select, 🇭🇰HK-IDC, 🇺🇸USA-ISP, icon-url=${ICON_BASE}YouTube.png`));
        assert.doesNotMatch(text, /^.+ = select,(?:[^\n]*,)?\s*REJECT(?:,|$)/m);
        assert.ok(text.split("\n").includes(`AppleDirect = select, DIRECT, icon-url=${ICON_BASE}Apple.png, hidden=true`));
        assert.doesNotMatch(text.split("[Rule]\n")[1], /^RULE-SET,.*hidden=/m);
        const sources = [...text.matchAll(/^RULE-SET,(https:\/\/[^,]+),([^,]+),no-resolve,update-interval=86400$/gm)];
        assert.equal(sources.length, 24);
        assert.equal(sources[0][2], "WeChat");
        assert.equal(sources[0][1], WECHAT_URL);
        assert.deepEqual(sources.at(-1).slice(1), [DIRECT_URL, "DIRECT"]);
        for (const [, value] of sources.slice(1, -1)) {
          const source = new URL(value);
          assert.equal(source.origin, ORIGIN);
          assert.match(source.pathname, /^\/AtlasRouter\/rules\/magicrule\/surge\/[A-Za-z]+\.list$/);
          assert.equal(source.search, new URL(profile.subscriptionUrl).search);
        }
        assert.deepEqual(sources.slice(2, 8).map(([, , policy]) => policy), ["GlobalMedia", "AIProxy", "iCloud", "AppleDirect", "AppleDirect", "DIRECT"]);
      }
    }
  }
  for (const query of ["client=other", "client=clash&client=surge", "doh=true", "doh=1&doh=0"]) {
    assert.equal((await request(mf, `${profile.subscriptionUrl}&${query}`)).status, 400);
  }
  assert.equal((await request(mf, `${POOL_SUBSCRIPTION_PATH}?token=invalid&client=clash&doh=1`)).status, 401);
  assert.deepEqual(await json(await request(mf, POOL_STATE_PATH, { subject: "admin" })), before);
  await json(await request(mf, ACCOUNT_TOKEN_PATH, { subject: "alice", method: "POST", body: {} }));
  assert.equal((await request(mf, `${profile.subscriptionUrl}&client=clash&doh=1`)).status, 401);
});

test("Tencent OA changes proxy exceptions, preserves targeted DNS hijacking and token checks", async (t) => {
  const mf = await createRuntime(t);
  await save(mf);
  const profile = await account(mf);
  const before = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  const withoutOverrides = (value) => value.replace(/^#!MANAGED-CONFIG .*\n/m, "").replace(/^skip-proxy = .*\n/m, "");
  for (const doh of ["0", "1"]) {
    let plain;
    for (const tencentOa of ["0", "1"]) {
      const response = await request(mf, `${profile.subscriptionUrl}&tencent_oa=${tencentOa}&doh=${doh}`);
      assert.equal(response.status, 200);
      const body = await response.text();
      const managed = new URL(body.match(/^#!MANAGED-CONFIG (\S+)/)[1]);
      assert.equal(managed.searchParams.get("tencent_oa"), tencentOa === "1" ? "1" : null);
      assert.equal(managed.searchParams.get("doh"), doh === "1" ? "1" : null);
      assert.equal(/^encrypted-dns-server =/m.test(body), doh === "1");
      assert.deepEqual(body.match(/^hijack-dns\s*=.*$/gm), ["hijack-dns = 8.8.8.8:53, 8.8.4.4:53"]);
      assert.doesNotMatch(body, /TencentOA|10\.28\.0\.21/);
      assert.match(body, /\[Host\]\nzslab\.ai = server:223\.5\.5\.5, 119\.29\.29\.29\n\*\.zslab\.ai = server:223\.5\.5\.5, 119\.29\.29\.29\n/);
      const skip = body.match(/^skip-proxy = (.+)$/m)[1].split(",").map((value) => value.trim());
      for (const value of ["oa.com", "*.oa.com", "woa.com", "*.woa.com", "*tencentyun.com", "*workbuddy.cn", "10.0.0.0/7", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.1", "169.254.0.0/16", "21.0.0.0/8", "28.0.0.0/7"]) assert.equal(skip.includes(value), tencentOa === "1");
      if (tencentOa === "0") plain = withoutOverrides(body);
      else assert.equal(withoutOverrides(body), plain);
    }
  }
  assert.equal((await request(mf, `${POOL_SUBSCRIPTION_PATH}?tencent_oa=1`, { subject: "alice" })).status, 401);
  assert.equal((await request(mf, `${POOL_SUBSCRIPTION_PATH}?token=invalid&tencent_oa=1`)).status, 401);
  const enabledUrl = `${profile.subscriptionUrl}&tencent_oa=1`;
  assert.equal((await request(mf, `${enabledUrl}&token=duplicate`)).status, 401);
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) assert.equal((await request(mf, enabledUrl, { method })).status, 405);
  for (const query of ["tencent_oa=", "tencent_oa=true", "tencent_oa=1&tencent_oa=1", "client=clash&tencent_oa=1"]) {
    assert.equal((await request(mf, `${profile.subscriptionUrl}&${query}`)).status, 400);
  }
  for (const route of ["/AtlasRouter/rules/TencentOA-Domain.list", "/AtlasRouter/rules/TencentOA-IP.list", "/AtlasRouter/hosts/TencentOA-Host.conf"]) {
    for (const query of ["", new URL(profile.subscriptionUrl).search, `${new URL(profile.subscriptionUrl).search}&scope=fallback`]) {
      assert.equal((await request(mf, route + query)).status, 404);
    }
  }
  assert.deepEqual(await json(await request(mf, POOL_STATE_PATH, { subject: "admin" })), before);
  const rotated = await json(await request(mf, ACCOUNT_TOKEN_PATH, { subject: "alice", method: "POST", body: {} }));
  assert.equal((await request(mf, enabledUrl)).status, 401);
  const replacement = `${rotated.subscriptionUrl}&tencent_oa=1`;
  assert.equal((await request(mf, replacement)).status, 200);
  await json(await request(mf, POOL_USERS_PATH, { subject: "admin", method: "PATCH", body: { id: before.users[0].id, enabled: false } }));
  assert.equal((await request(mf, replacement)).status, 401);
});

test("inventory updates allocate all groups and reduce sharing when capacity grows", async (t) => {
  const mf = await createRuntime(t);
  const alice = await account(mf, "alice");
  assert.equal(alice.status, "pending");
  assert.equal((await request(mf, alice.subscriptionUrl)).status, 503);
  await save(mf, [...nodes(2), ...nodes(1, "IDC", "🇭🇰")]);
  const bob = await account(mf, "bob");
  assert.equal(bob.status, "active");
  assert.equal(bob.groups.find((group) => group.group === "🇭🇰HK-IDC").primaryId, "IDC-1");
  const before = await account(mf, "alice");
  await save(mf, [...nodes(2), ...nodes(2, "IDC", "🇭🇰")], 1);
  const after = await account(mf, "alice");
  assert.equal(before.subscriptionUrl, after.subscriptionUrl);
  assert.deepEqual(before.groups.map((group) => group.primaryId), after.groups.map((group) => group.primaryId));
  assert.equal((await account(mf, "bob")).status, "active");
  assert.equal((await account(mf, "bob")).groups.find((group) => group.group === "🇭🇰HK-IDC").primaryId, "IDC-2");
  const config = await (await request(mf, bob.subscriptionUrl)).text();
  assert.match(config, /^🇭🇰HK-IDC = smart,/m);
  assert.doesNotMatch(config, /{{/);
});

test("removing an assigned node reassigns users and removes it from stored inventory and both subscriptions", async (t) => {
  const mf = await createRuntime(t);
  const entries = [...nodes(), ...nodes(1, "IDC", "🇭🇰")];
  await save(mf, entries);
  const profiles = [];
  for (const subject of ["alice", "bob", "carol", "dave", "erin", "frank"]) profiles.push(await account(mf, subject));
  const before = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  const removed = before.nodes.find((node) => node.id === "ISP-2");
  assert.equal(removed.ownerIds.length, 2);
  const saved = await save(mf, entries.filter((node) => node.id !== removed.id).reverse(), before.revision);
  assert.deepEqual(saved.nodes.map((node) => node.id), ["ISP-1", "ISP-3", "IDC-1"]);
  assert.deepEqual(saved.nodes.map((node) => node.ownerIds.length), [3, 3, 6]);
  assert.deepEqual(await json(await request(mf, POOL_STATE_PATH, { subject: "admin" })), saved);
  const env = { DB: await mf.getD1Database("DB") };
  const stored = await readSubscriptionState(env);
  assert.deepEqual(stored.state.nodes, saved.nodes);
  assert.equal(stored.rows.assignments.length, 12);
  assert.ok(stored.rows.assignments.every((row) => row.node_id !== removed.id));
  for (const profile of profiles) {
    const current = await account(mf, profile.email.split("@")[0]);
    assert.equal(current.id, profile.id);
    assert.equal(current.subscriptionUrl, profile.subscriptionUrl);
    const oldIsp = profile.groups.find((group) => group.group === removed.group);
    const isp = current.groups.find((group) => group.group === removed.group);
    if (oldIsp.primaryId !== removed.id) assert.equal(isp.primaryId, oldIsp.primaryId);
    assert.deepEqual(new Set(isp.nodes.map((node) => node.id)), new Set(["ISP-1", "ISP-3"]));
    assert.deepEqual(current.groups.find((group) => group.group === "🇭🇰HK-IDC"), profile.groups.find((group) => group.group === "🇭🇰HK-IDC"));
    for (const client of ["surge", "clash"]) {
      const response = await request(mf, `${profile.subscriptionUrl}&client=${client}`);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(!body.includes(removed.name));
      if (client === "clash") {
        const config = parseYaml(body);
        assert.equal(config.proxies.length, 3);
        assert.deepEqual(config["proxy-groups"].find((group) => group.name === removed.group).proxies, isp.nodes.map((node) => node.name));
      } else {
        assert.deepEqual(orderedSmartMembers(body, isp.group), isp.nodes.map((node) => node.name));
        assert.match(body, /^FINAL,Proxy,dns-failed$/m);
      }
    }
  }
  assert.equal((await request(mf, POOL_NODES_PATH, {
    subject: "admin", method: "PUT", body: { nodes: entries, revision: before.revision },
  })).status, 409);
  assert.deepEqual(await readSubscriptionState(env), stored);

  const singleGroup = await save(mf, entries.filter((node) => node.id === "IDC-1"), saved.revision);
  assert.deepEqual((await account(mf)).groups.map((group) => group.group), ["🇭🇰HK-IDC"]);
  assert.equal((await request(mf, profiles[0].subscriptionUrl)).status, 200);
  const empty = await save(mf, [], singleGroup.revision);
  const cleared = await readSubscriptionState(env);
  assert.deepEqual(cleared.rows.nodes, []);
  assert.deepEqual(cleared.rows.assignments, []);
  assert.deepEqual(cleared.rows.users, stored.rows.users);
  const pending = await account(mf);
  assert.equal(pending.status, "pending");
  assert.equal(pending.subscriptionUrl, profiles[0].subscriptionUrl);
  assert.equal((await request(mf, pending.subscriptionUrl)).status, 503);
  await save(mf, nodes(1), empty.revision);
  assert.equal((await request(mf, pending.subscriptionUrl)).status, 200);
});

test("token rotation is immediate; deactivation revokes links and releases nodes", async (t) => {
  const mf = await createRuntime(t);
  await save(mf, nodes(1));
  const alice = await account(mf);
  const bob = await account(mf, "bob");
  const rotated = await json(await request(mf, ACCOUNT_TOKEN_PATH, { subject: "alice", method: "POST", body: { id: bob.id } }));
  assert.equal(rotated.id, alice.id, "body must not select a different account");
  assert.notEqual(rotated.subscriptionUrl, alice.subscriptionUrl);
  assert.equal((await request(mf, alice.subscriptionUrl)).status, 401);
  assert.equal((await request(mf, rotated.subscriptionUrl)).status, 200);
  await json(await request(mf, POOL_USERS_PATH, { subject: "admin", method: "PATCH", body: { id: alice.id, enabled: false } }));
  assert.equal((await request(mf, rotated.subscriptionUrl)).status, 401);
  assert.equal((await request(mf, ACCOUNT_PROFILE_PATH, { subject: "alice" })).status, 403);
  assert.equal((await account(mf, "bob")).status, "active");
  await json(await request(mf, POOL_USERS_PATH, { subject: "admin", method: "PATCH", body: { id: alice.id, enabled: true } }));
  assert.equal((await request(mf, rotated.subscriptionUrl)).status, 401);
  assert.equal((await account(mf)).status, "active");
});

test("verified normalized email identifies users across subjects and ignores query parameters", async (t) => {
  const mf = await createRuntime(t);
  const alice = await account(mf);
  const returning = await account(mf, "new-subject", { email: " ALICE@EXAMPLE.COM " });
  assert.equal(returning.id, alice.id);
  assert.equal(returning.subscriptionUrl, alice.subscriptionUrl);
  const different = await account(mf, "alice", { email: "bob@example.com" });
  assert.notEqual(different.id, alice.id);
  const selected = await json(await request(mf, `${ACCOUNT_PROFILE_PATH}?id=${different.id}&email=bob@example.com`, { subject: "alice" }));
  assert.equal(selected.id, alice.id);
  assert.doesNotMatch(JSON.stringify(selected), /bob@example.com/);
});

test("imported drafts deduplicate and reach subscriptions only after an explicit inventory save", async (t) => {
  const mf = await createRuntime(t);
  const link = "vmess://" + Buffer.from(JSON.stringify({
    ps: "🇺🇸 Imported - ISP", add: "node.example.com", port: 443,
    id: "00000000-0000-4000-8000-000000000001", net: "tcp", tls: "tls", alpn: "h2,http/1.1",
  })).toString("base64");
  const before = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  const draft = await json(await request(mf, POOL_IMPORT_PATH, {
    subject: "admin", method: "POST", body: { text: `${link}\n${link}`, nodes: [] },
  }));
  assert.equal(draft.added, 1);
  assert.equal(draft.duplicates, 1);
  assert.deepEqual(await json(await request(mf, POOL_STATE_PATH, { subject: "admin" })), before);
  const saved = await save(mf, draft.nodes, before.revision);
  assert.equal(saved.nodes[0].group, "🇺🇸USA-ISP");
  const duplicate = await json(await request(mf, POOL_IMPORT_PATH, {
    subject: "admin", method: "POST", body: { text: link, nodes: draft.nodes },
  }));
  assert.equal(duplicate.added, 0);
  assert.equal(duplicate.duplicates, 1);
  assert.deepEqual(duplicate.nodes, draft.nodes);
  const profile = await account(mf);
  const config = await (await request(mf, profile.subscriptionUrl)).text();
  assert.ok(config.includes(draft.nodes[0].line));
  assert.match(config, /^FINAL,Proxy,dns-failed$/m);
  assert.equal((await request(mf, POOL_IMPORT_PATH, {
    subject: "admin", method: "POST", body: { text: link, nodes: [] }, headers: { origin: "https://foreign.example" },
  })).status, 403);
});

test("mutations reject cross-origin, malformed and stale writes without corrupting state", async (t) => {
  const mf = await createRuntime(t);
  await save(mf);
  const writes = await Promise.all([
    request(mf, POOL_NODES_PATH, { subject: "admin", method: "PUT", body: { revision: 1, nodes: nodes(4) } }),
    request(mf, POOL_NODES_PATH, { subject: "admin", method: "PUT", body: { revision: 1, nodes: nodes(5) } }),
  ]);
  assert.deepEqual(writes.map((response) => response.status).sort(), [200, 409]);
  const initial = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  for (const headers of [{ origin: "https://foreign.example" }, { origin: "null" }, { origin: "" }]) {
    assert.equal((await request(mf, POOL_NODES_PATH, { subject: "admin", method: "PUT", body: { revision: 2, nodes: [] }, headers })).status, 403);
    assert.equal((await request(mf, ACCOUNT_TOKEN_PATH, { subject: "alice", method: "POST", body: {}, headers })).status, 403);
  }
  assert.equal((await request(mf, POOL_NODES_PATH, { subject: "admin", method: "PUT", body: {}, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await request(mf, POOL_NODES_PATH, { subject: "admin", method: "PUT", body: null })).status, 400);
  assert.equal((await request(mf, POOL_NODES_PATH, { subject: "admin", method: "PUT", body: { revision: 2, nodes: [null] } })).status, 400);
  assert.equal((await request(mf, POOL_NODES_PATH, { subject: "admin", method: "PUT", body: { data: "a".repeat(513 * 1024) } })).status, 413);
  const final = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  assert.deepEqual(final, initial);
});

test("D1 preserves identities, tokens and allocations across runtime restarts", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "atlas-subscriptions-"));
  let mf = new Miniflare(runtimeOptions(directory));
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  await initializeDatabase(mf);
  await save(mf);
  const subjects = ["alice", "bob", "carol", "dave", "erin", "frank"];
  const before = await Promise.all(subjects.map((subject) => account(mf, subject)));
  await mf.dispose();
  mf = new Miniflare(runtimeOptions(directory));
  await initializeDatabase(mf);
  assert.deepEqual(await Promise.all(subjects.map((subject) => account(mf, subject))), before);
  assert.equal((await request(mf, before[0].subscriptionUrl)).status, 200);
});


test("D1 migrates populated snapshots to relational rows and keeps existing tokens and fallback order", async (t) => {
  const mf = new Miniflare(runtimeOptions());
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await applyMigrations(db, migrations.slice(0, 1));
  const now = "2026-01-01T00:00:00.000Z";
  const state = { version: 1, revision: 4, nodes: parsePoolNodes(nodes()), users: Array.from({ length: 6 }, (_, index) => ({
    id: `seed-${index}`, email: `seed-${index}@example.com`, subscribeToken: `ar_${index.toString(16).padStart(64, "0")}`, enabled: true, createdAt: now,
  })) };
  allocateNodes(state, now);
  const manual = { subscribeToken: "legacy-seed-token", nodes: { group: "🇺🇸 US", value: ["LEGACY = direct"] } };
  await db.batch([
    db.prepare("INSERT INTO configs (key, value, version) VALUES (?, ?, ?)").bind("subscriptions", JSON.stringify(state), 9),
    db.prepare("INSERT INTO configs (key, value) VALUES (?, ?)").bind("router-config", JSON.stringify(manual)),
  ]);
  await applyMigrations(db);
  await applyMigrations(db);
  assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'configs'").first(), null);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM assignments").first()).count, 6);
  const stored = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  assert.equal(stored.revision, 4);
  assert.deepEqual(stored.nodes, state.nodes);
  for (const person of state.users) {
    const profile = await account(mf, person.id);
    assert.equal(profile.id, person.id);
    assert.equal(new URL(profile.subscriptionUrl).searchParams.get("token"), person.subscribeToken);
    const expected = userGroups(state, person.id)[0].nodes.map((node) => node.name);
    assert.deepEqual(profile.groups[0].nodes.map((node) => node.name), expected);
    const response = await request(mf, profile.subscriptionUrl);
    assert.equal(response.status, 200);
    assert.deepEqual(orderedSmartMembers(await response.text(), "🇺🇸USA-ISP"), expected);
  }
  assert.equal((await request(mf, "/AtlasRouter?token=legacy-seed-token")).status, 401);
});

test("D1 rolls back a rejected migration and retains the old data for correction", async (t) => {
  const mf = new Miniflare(runtimeOptions());
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await applyMigrations(db, migrations.slice(0, 1));
  await db.prepare("INSERT INTO configs (key, value) VALUES (?, ?)").bind("subscriptions", JSON.stringify({ version: 99, revision: 0, users: [], nodes: [] })).run();
  await assert.rejects(() => applyMigrations(db), /CHECK constraint failed/);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM configs").first()).count, 1);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM d1_migrations").first()).count, 1);
  assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").first(), null);
  await db.prepare("UPDATE configs SET value = ? WHERE key = ?").bind(JSON.stringify({ version: 1, revision: 0, users: [], nodes: [] }), "subscriptions").run();
  await applyMigrations(db);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM users").first()).count, 0);
});

test("concurrent registration, inventory growth and token rotation keep all relational updates", async (t) => {
  const mf = await createRuntime(t);
  await save(mf);
  const alice = await account(mf);
  const [updated, rotated, ...newcomers] = await Promise.all([
    save(mf, nodes(120), 1),
    request(mf, ACCOUNT_TOKEN_PATH, { subject: "alice", method: "POST", body: {} }).then((response) => json(response)),
    ...Array.from({ length: 8 }, (_, index) => account(mf, `new-${index}`)),
  ]);
  assert.equal(updated.revision, 2);
  assert.notEqual(alice.subscriptionUrl, rotated.subscriptionUrl);
  assert.equal((await request(mf, alice.subscriptionUrl)).status, 401);
  assert.equal((await request(mf, rotated.subscriptionUrl)).status, 200);
  const state = await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }));
  assert.equal(state.users.length, 9);
  assert.equal(state.nodes.length, 120);
  assert.equal(state.nodes.reduce((count, node) => count + node.ownerIds.length, 0), 9);
  assert.ok(state.nodes.every((node) => node.ownerIds.length <= 1));
  for (const person of newcomers) assert.equal((await request(mf, person.subscriptionUrl)).status, 200);
});
