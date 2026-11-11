import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { applyMigrations, migrations } from "../test-helpers/migrations.js";
import { CHECK_INTERVAL } from "../src/magic-rule-check.js";
import { magicRuleSources } from "../src/magic-rules.js";
import { allocateNodes, parsePoolNodes, userGroups } from "../src/node-pool.js";
import { readSubscriptionState } from "../src/subscription-db.js";
import { splitSurgeList, surgeAssignment, surgeOptions } from "../src/surge-format.js";
import {
  ACCOUNT_PATH, ACCOUNT_PROFILE_PATH, ACCOUNT_TOKEN_PATH, POOL_SUBSCRIPTION_PATH, getAdminRoutes,
} from "../src/routes.js";

const ADMIN_API_SLUG = "0123456789abcdef0123456789abcdef";
const { state: POOL_STATE_PATH, nodes: POOL_NODES_PATH, users: POOL_USERS_PATH, import: POOL_IMPORT_PATH } = getAdminRoutes({ ADMIN_API_SLUG });
const ORIGIN = "https://atlas.example";

const WECHAT_URL = "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/WeChat.list";
const WECHAT_RULE_ID = `rule-${createHash("sha256").update(`RULE-SET:${WECHAT_URL}`).digest("hex").slice(0, 32)}`;
const CUSTOM_DIRECT_URL = "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/CustomDirect.list";
const CUSTOM_DIRECT_RULE_ID = `rule-${createHash("sha256").update(`RULE-SET:${CUSTOM_DIRECT_URL}`).digest("hex").slice(0, 32)}`;
const CUSTOM_REJECT_URL = "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/CustomReject.list";
const RED_POCKET_URL = "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/RedPocket.list";
const RED_POCKET_RULE_ID = `rule-${createHash("sha256").update(`RULE-SET:${RED_POCKET_URL}`).digest("hex").slice(0, 32)}`;
const COIN_URL = "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/Coin.list";
const CUSTOM_AI_URL = "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/CustomAI.list";
const REPOSITORY_RULE_SET_URLS = [CUSTOM_REJECT_URL, RED_POCKET_URL, CUSTOM_DIRECT_URL, WECHAT_URL, CUSTOM_AI_URL, COIN_URL];
const magicRuleRelay = (url, name, client, base = `${ORIGIN}${POOL_SUBSCRIPTION_PATH}`, query = "") =>
  new RegExp(`^${`${base}/rules/magicrule/${client}/`.replace(/\./g, "\\.")}${name}\\.${client === "surge" ? "list" : "yaml"}${query.replace(/\?/g, "\\?")}$`).test(url);
const MEDIA_RULE_NAMES = ["Netflix", "Disney", "Spotify", "TIDAL", "TikTok"];
const DIRECT_URL = `${ORIGIN}${POOL_SUBSCRIPTION_PATH}/rules/magicrule/surge/China.list`;
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

function runtimeOptions(directory, bindings = {}, outboundService) {
  return convertV4MiniflareOptions({
    name: "atlas-router-tests", modules: true, scriptPath: ".wrangler/test-dist/index.js",
    compatibilityDate: "2026-05-12",
    d1Databases: ["DB"],
    ...(outboundService ? { outboundService } : {}),
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

test("Tailnet secret adds authenticated test alternatives without changing stored nodes or assignments", async (t) => {
  const mf = await createRuntime(t, { SUBSCRIPTION_PATH: "/AtlasRouter", TAILNET_ENDPOINTS: JSON.stringify([
    { server: "hk.example.com", port: 443, hostname: "node.example-tailnet.ts.net" },
  ]) });
  const line = "🇭🇰 HK IDC = vmess, hk.example.com, 443, username=11111111-2222-4333-8444-555555555555, vmess-aead=true, tls=true";
  await save(mf, [{ id: "hk", line }]);
  const user = await account(mf);
  const db = await mf.getD1Database("DB");
  const before = await readSubscriptionState({ DB: db });
  const url = new URL(user.subscriptionUrl);
  url.pathname = "/AtlasRouter";
  const response = await mf.dispatchFetch(url.toString());
  assert.equal(response.status, 200);
  const profile = await response.text();
  assert.ok(profile.split("\n").includes(line));
  assert.match(profile, /^Tailnet Test - 🇭🇰 HK IDC = vmess, node\.example-tailnet\.ts\.net, 443, .+underlying-proxy=Tailnet$/m);
  assert.match(profile, /^Tailnet Test = select, Tailnet Test - 🇭🇰 HK IDC$/m);
  assert.deepEqual(await readSubscriptionState({ DB: db }), before);
  assert.equal((await mf.dispatchFetch(`${ORIGIN}/AtlasRouter`)).status, 401);
  assert.equal((await mf.dispatchFetch(`${ORIGIN}/not-a-subscription`)).status, 404);
  const clash = await mf.dispatchFetch(`${url}&client=clash`);
  assert.equal(clash.status, 200);
  const config = parseYaml(await clash.text());
  assert.deepEqual(config.proxies.map((node) => [node.name, node.type, node.server, node["dialer-proxy"]]), [
    ["🇭🇰 HK IDC", "vmess", "hk.example.com", undefined],
    ["Tailnet Test - 🇭🇰 HK IDC", "vmess", "node.example-tailnet.ts.net", "Tailnet"],
    ["Tailnet", "tailscale", undefined, undefined],
  ]);
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
  const members = orderedSmartMembers(surge, "🇺🇸USA-ISP", [1, 100, 1000, 10000, 100000]);
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

test("unconfigured Dev cannot change production accounts or the retained test database", async (t) => {
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "production-only", modules: true,
    scriptPath: ".wrangler/test-dist/index.js", compatibilityDate: "2026-05-12",
    d1Databases: { DB: "production", DEV_DB: "retained-test" },
    bindings: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "portal-app", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
      ADMIN_EMAILS: "admin@example.com", ADMIN_API_SLUG, DEV_SUBSCRIPTION_ORIGIN: "https://retired.example" },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  const testDb = await mf.getD1Database("DEV_DB");
  await applyMigrations(db);
  await applyMigrations(testDb);
  await save(mf);
  const profile = await account(mf);
  const before = await readSubscriptionState({ DB: db });
  const testBefore = await readSubscriptionState({ DB: testDb });
  for (const query of ["?environment=development", "?dev=1"]) {
    for (const [route, method, body] of [["/", "GET"], [ACCOUNT_PROFILE_PATH, "GET"],
      [ACCOUNT_TOKEN_PATH, "POST", {}], [POOL_STATE_PATH, "GET"],
      [POOL_NODES_PATH, "PUT", { revision: 1, nodes: [] }],
      [POOL_USERS_PATH, "PATCH", { id: before.state.users[0].id, enabled: false }],
      [POOL_IMPORT_PATH, "POST", { text: "https://retired.example/sub", nodes: [] }]]) {
      assert.equal((await request(mf, route + query, { subject: "admin", method, body })).status, query.includes("environment") ? 503 : 404);
    }
  }
  assert.equal((await request(mf, POOL_STATE_PATH.replace("/state", "/reset-production"), {
    subject: "admin", method: "POST", body: { revision: 1 },
  })).status, 404);
  const retired = new URL(profile.subscriptionUrl);
  retired.pathname = "/AtlasRouter-Dev";
  assert.equal((await request(mf, retired.toString())).status, 503);
  assert.equal((await request(mf, profile.subscriptionUrl + "&dev=1")).status, 503);
  for (const client of ["surge", "clash"]) assert.equal((await request(mf, profile.subscriptionUrl + "&client=" + client)).status, 200);
  const page = await request(mf, "/", { subject: "admin" });
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /environment=development|reset-production|>Dev</);
  assert.equal((await account(mf)).subscriptionUrl, profile.subscriptionUrl);
  assert.deepEqual(await readSubscriptionState({ DB: db }), before);
  assert.deepEqual(await readSubscriptionState({ DB: testDb }), testBefore);
});

test("Dev portal and private service isolate data, tokens, module links and token rotation", async (t) => {
  const devNodes = nodes(3).map((node) => ({ ...node, line: node.line.replace("Example", "Development")
    .replace("trojan,", "vmess,").replace("password=TEST_ONLY", "username=11111111-2222-4333-8444-555555555555, vmess-aead=true, tls=true") }));
  const endpoints = devNodes.map((_, index) => ({ server: `node-${index + 1}.example.com`, port: 443,
    hostname: `node-${index + 1}.example-tailnet.ts.net` }));
  const common = { modules: true, scriptPath: ".wrangler/test-dist/index.js", compatibilityDate: "2026-05-12" };
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { ...common, name: "portal", d1Databases: { DB: "production", DEV_DB: "development" },
      serviceBindings: { DEV_SUBSCRIPTION_SERVICE: "development" },
      bindings: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "portal-app", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
        ADMIN_EMAILS: "admin@example.com", ADMIN_API_SLUG } },
    { ...common, name: "development", d1Databases: { DB: "development" },
      bindings: { UI_ENABLED: "false", SUBSCRIPTION_VARIANT: "development", SMART_PRIORITY_SCHEME: "geometric-10", SHOW_ALL_PROXY_GROUPS: "true",
        TAILNET_ENDPOINTS: JSON.stringify(endpoints) } },
  ] }));
  t.after(() => mf.dispose());
  const prodDb = await mf.getD1Database("DB", "portal");
  const devDb = await mf.getD1Database("DB", "development");
  await applyMigrations(prodDb);
  await applyMigrations(devDb);
  await save(mf, nodes(2).map((node) => ({ ...node, line: node.line.replace("Example", "Production") })));
  const production = await account(mf);
  const before = await readSubscriptionState({ DB: prodDb });
  const query = "?environment=development";
  const devApi = (path) => path.replace("/api/", "/api/AtlasRouter-Dev/");
  await json(await request(mf, devApi(POOL_NODES_PATH), { subject: "admin", method: "PUT",
    body: { revision: 0, nodes: devNodes } }));
  const dev = await json(await request(mf, devApi(ACCOUNT_PROFILE_PATH), { subject: "alice" }));
  assert.equal(new URL(dev.subscriptionUrl).pathname, "/AtlasRouter-Dev");
  assert.equal(new URL(dev.subscriptionUrl).searchParams.get("dev"), null);
  assert.equal((await request(mf, devApi(ACCOUNT_PROFILE_PATH))).status, 403);
  assert.equal((await request(mf, "/AtlasRouter-Dev")).status, 401);
  assert.equal((await request(mf, "/AtlasRouter-Dev/modules/missing")).status, 404);
  assert.equal((await json(await request(mf, devApi(ACCOUNT_PROFILE_PATH) + "?environment=production", { subject: "alice" }))).subscriptionUrl, dev.subscriptionUrl);
  assert.notEqual(new URL(dev.subscriptionUrl).searchParams.get("token"), new URL(production.subscriptionUrl).searchParams.get("token"));
  const page = await request(mf, "/" + query, { subject: "admin" });
  assert.match(await page.text(), /id="enable-dev" type="checkbox" role="switch" checked/);
  const devBefore = await readSubscriptionState({ DB: devDb });
  for (const client of ["surge", "clash"]) {
    const response = await request(mf, dev.subscriptionUrl + "&client=" + client + "&doh=1");
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /Development/);
    assert.doesNotMatch(text, /Production|Tailnet Test|node-\d\.example\.com/);
    if (client === "surge") {
      assert.equal(text.split("\n").filter((line) => / = vmess, .+underlying-proxy=Tailnet$/.test(line)).length, 3);
    } else {
      const proxies = parseYaml(text).proxies.filter(({ type }) => type !== "tailscale");
      assert.equal(proxies.length, 3);
      assert.ok(proxies.every((node) => node.server.endsWith(".example-tailnet.ts.net") && node["dialer-proxy"] === "Tailnet"));
    }
  }
  assert.deepEqual(await readSubscriptionState({ DB: devDb }), devBefore);
  // A missing mapping fails the whole subscription; URL options cannot restore public nodes.
  const unmatched = { id: "unmapped", line: devNodes[0].line.replace("ISP 1", "IDC 4").replace("node-1.example.com", "unmapped.example.com") };
  await json(await request(mf, devApi(POOL_NODES_PATH), { subject: "admin", method: "PUT",
    body: { revision: devBefore.state.revision, nodes: [...devNodes, unmatched] } }));
  for (const client of ["surge", "clash"]) {
    const response = await request(mf, dev.subscriptionUrl + "&client=" + client + "&tailnetOnly=false&environment=production");
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /11111111|example\.com|vmess|\[Proxy\]/);
  }
  const unmatchedState = await readSubscriptionState({ DB: devDb });
  await json(await request(mf, devApi(POOL_NODES_PATH), { subject: "admin", method: "PUT",
    body: { revision: unmatchedState.state.revision, nodes: devNodes } }));
  assert.equal((await request(mf, production.subscriptionUrl + "&dev=1")).status, 401);
  const wrong = new URL(dev.subscriptionUrl);
  wrong.pathname = "/AtlasRouter";
  assert.equal((await request(mf, wrong.toString())).status, 401);
  const module = new URL(dev.subscriptionUrl);
  module.pathname += "/modules/tencent-oa.sgmodule";
  assert.equal((await request(mf, module.toString())).status, 200);
  const legacy = new URL(dev.subscriptionUrl);
  legacy.pathname = "/AtlasRouter";
  legacy.searchParams.set("dev", "1");
  const compatibility = await request(mf, legacy.toString());
  assert.equal(compatibility.status, 200);
  assert.match(await compatibility.text(), /^#!MANAGED-CONFIG https:\/\/atlas\.example\/AtlasRouter-Dev\?token=/);
  const rotated = await json(await request(mf, devApi(ACCOUNT_TOKEN_PATH), { subject: "alice", method: "POST", body: {} }));
  assert.equal((await request(mf, dev.subscriptionUrl)).status, 401);
  assert.equal((await request(mf, rotated.subscriptionUrl)).status, 200);
  assert.equal((await request(mf, production.subscriptionUrl)).status, 200);
  assert.deepEqual(await readSubscriptionState({ DB: prodDb }), before);
  assert.equal((await (await mf.getWorker("development")).fetch(ORIGIN + "/")).status, 404);
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
    assert.match(config, /^FINAL,FINAL,dns-failed$/m);
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
  for (const route of ["/atlasrouter", "/atlasrouter/modules/skip-proxy-lists.sgmodule", "/atlas-router", "/AtlasRouter/subscription", "/modules/skip-proxy-lists.sgmodule", "/AtlasRouter/subscription/modules/skip-proxy-lists.sgmodule", "/AtlasRouter/rules/magicrule/surge/WeChat.list", "/AtlasRouter/rules/magicrule/mihomo/WeChat.yaml", "/AtlasRouter/rules/magicrule/surge/GlobalMedia.list", "/AtlasRouter/rules/magicrule/mihomo/GlobalMedia.yaml"]) {
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

test("MagicRule relay needs no token, answers 304 and serves the copy kept in D1 while the upstream returns HTML", async (t) => {
  const manifestUrl = JSON.parse(await readFile("../surge/magicrule.json", "utf8")).China.mihomo;
  const artifactUrl = `${new URL(manifestUrl).origin}/data/_shared/artifacts/China_classical_test.yaml`;
  const body = `payload:\n${Array.from({ length: 10000 }, (_, index) => `  - 'DOMAIN-SUFFIX,site-${index}.example.cn'`).join("\n")}\n`;
  let healthy = true;
  const requested = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: "atlas-router-tests", modules: true, scriptPath: ".wrangler/test-dist/index.js",
    compatibilityDate: "2026-05-12", d1Databases: ["DB"],
    outboundService: async (upstream) => {
      requested.push(upstream.url);
      if (!healthy) return new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } });
      if (upstream.url === manifestUrl) return Response.json({ client: "Mihomo", rule: "China", artifacts: [{ role: "full", ext: "yaml", url: artifactUrl }] });
      return upstream.url === artifactUrl ? new Response(body) : new Response(null, { status: 404 });
    },
  }));
  t.after(() => mf.dispose());
  await initializeDatabase(mf);
  const route = `${POOL_SUBSCRIPTION_PATH}/rules/magicrule/mihomo/China.yaml`;
  const fresh = await request(mf, route);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get("content-type"), "application/yaml; charset=utf-8");
  assert.equal(fresh.headers.get("cache-control"), "no-cache");
  assert.equal(await fresh.text(), body);
  assert.deepEqual(requested, [manifestUrl, artifactUrl]);
  const etag = fresh.headers.get("etag");
  const stored = await (await mf.getD1Database("DB")).prepare("SELECT sha256, length(body) AS size FROM magic_rule_sets WHERE name = 'China' AND client = 'mihomo'").first();
  assert.deepEqual({ ...stored }, { sha256: etag.slice(1, -1), size: body.length });
  assert.equal((await request(mf, route, { headers: { "if-none-match": etag } })).status, 304);
  healthy = false;
  const fallback = await request(mf, route);
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers.get("etag"), etag);
  assert.equal(await fallback.text(), body);
  const missing = await request(mf, `${POOL_SUBSCRIPTION_PATH}/rules/magicrule/surge/China.list`);
  assert.equal(missing.status, 502);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal((await request(mf, route, { method: "HEAD" })).status, 405);
  assert.equal((await request(mf, `${POOL_SUBSCRIPTION_PATH}/rules/magicrule/mihomo/Copilot.yaml`)).status, 404);
});

test("the scheduled handler checks one MagicRule list per run in workerd and reports repeated failures through Bark", async (t) => {
  const sources = magicRuleSources();
  const index = sources.findIndex((source) => source.name === "China" && source.client === "mihomo");
  const requested = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: "atlas-router-tests", modules: true, scriptPath: ".wrangler/test-dist/index.js",
    compatibilityDate: "2026-05-12", d1Databases: ["DB"], bindings: { BARK_DEVICE_KEY: "test-device-key" },
    outboundService: async (upstream) => {
      requested.push({ method: upstream.method, url: upstream.url, body: upstream.method === "POST" ? await upstream.json() : null });
      return upstream.url === "https://api.day.app/push" ? Response.json({ code: 200, message: "success" })
        : new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } });
    },
  }));
  t.after(() => mf.dispose());
  await initializeDatabase(mf);
  const worker = await mf.getWorker();
  const run = (round) => worker.scheduled({ cron: "*/5 * * * *", scheduledTime: new Date((index + round * sources.length) * CHECK_INTERVAL) });
  assert.equal((await run(0)).outcome, "ok");
  assert.deepEqual(requested, [{ method: "GET", url: sources[index].manifest, body: null }]);
  assert.equal((await run(1)).outcome, "ok");
  assert.equal(requested.length, 3);
  const push = requested[2];
  assert.equal(push.method, "POST");
  assert.equal(push.url, "https://api.day.app/push");
  assert.equal(push.body.device_key, "test-device-key");
  assert.match(push.body.body, /^China（Mihomo）连续 2 次检查失败。/);
  const db = await mf.getD1Database("DB");
  const state = await db.prepare("SELECT failures, notified FROM magic_rule_checks WHERE name = 'China' AND client = 'mihomo'").first();
  assert.deepEqual({ ...state }, { failures: 2, notified: 1 });
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
        assert.equal(config["rule-providers"].GlobalMedia, undefined);
        assert.deepEqual(config.rules.filter((rule) => rule.endsWith(",GlobalMedia,no-resolve")),
          ["AppleTV", ...MEDIA_RULE_NAMES].map((name) => `RULE-SET,${name},GlobalMedia,no-resolve`));
        assert.equal(config.proxies.filter(({ type }) => type !== "tailscale").length, 4);
        for (const group of profile.groups) assert.deepEqual(config["proxy-groups"].find(({ name }) => name === group.group).proxies, group.nodes.map(({ name }) => name));
        assert.equal(config.dns.nameserver.every((server) => server.startsWith("https://")), doh === "1");
        assert.deepEqual(config.dns.nameserver, doh === "1" ? ["https://cloudflare-dns.com/dns-query#RULES", "https://dns.google/dns-query#RULES"] : ["223.5.5.5", "119.29.29.29", "system"]);
        assert.deepEqual(config.dns["proxy-server-nameserver"], ["223.5.5.5", "119.29.29.29", "system"]);
        assert.equal(config.dns["enhanced-mode"], "fake-ip");
        assert.deepEqual(config.dns["nameserver-policy"], {
          "use-application-dns.net": "rcode://name_error",
          "zslab.ai": ["223.5.5.5", "119.29.29.29"], ".zslab.ai": ["223.5.5.5", "119.29.29.29"],
          "dns.alidns.com": ["223.5.5.5", "119.29.29.29"], "doh.pub": ["223.5.5.5", "119.29.29.29"],
          ...Object.fromEntries([CUSTOM_DIRECT_RULE_ID, "IBKR", "Direct", "Apple", "China"].map((id) => [`rule-set:${id}`, doh === "1"
            ? ["https://dns.alidns.com/dns-query#RULES", "https://doh.pub/dns-query#RULES"]
            : ["223.5.5.5", "119.29.29.29"]])),
        });
        assert.equal(config["rule-providers"][CUSTOM_DIRECT_RULE_ID].url, CUSTOM_DIRECT_URL);
        assert.equal(config["rule-providers"][RED_POCKET_RULE_ID].url, RED_POCKET_URL);
        assert.ok(config.rules.includes(`RULE-SET,${RED_POCKET_RULE_ID},🇺🇸USA-ISP,no-resolve`));
        assert.ok(magicRuleRelay(config["rule-providers"].China.url, "China", "mihomo"));
        assert.equal(config["rule-providers"].China.format, "yaml");
        const auto = config["proxy-groups"].find(({ name }) => name === "Auto");
        assert.equal(auto.type, "url-test");
        assert.equal(auto.icon, `${ICON_BASE}Auto.png`);
        assert.deepEqual(auto.proxies, config.proxies.filter(({ type }) => type !== "tailscale").map(({ name }) => name));
        assert.equal(auto.tolerance, 50);
        for (const group of config["proxy-groups"].filter(({ type }) => type !== "select")) assert.equal(group["expected-status"], 204, group.name);
        assert.equal(config["geo-auto-update"], true);
        assert.equal(config["geo-update-interval"], 168);
        assert.equal(config["tcp-concurrent"], true);
        assert.deepEqual(config["proxy-groups"].find(({ name }) => name === "Proxy").proxies, ["🇺🇸USA-ISP", "🇭🇰HK-IDC", "Auto", "DIRECT"]);
        assert.deepEqual(config["proxy-groups"].find(({ name }) => name === "FINAL"), {
          name: "FINAL", type: "select", proxies: ["Auto", "Proxy", "🇭🇰HK-IDC", "🇺🇸USA-ISP", "DIRECT"], icon: `${ICON_BASE}Proxy.png`,
        });
        const dohProxy = config["proxy-groups"].find(({ name }) => name === "DoH Proxy");
        assert.equal(dohProxy.type, "url-test");
        assert.equal(dohProxy.icon, `${ICON_BASE}Server.png`);
        assert.equal(dohProxy.hidden, true);
        assert.deepEqual(dohProxy.proxies, ["🇭🇰 Example - IDC 1"]);
        for (const hostname of ["cloudflare-dns.com", "dns.google"]) assert.ok(config.rules.includes(`DOMAIN,${hostname},DoH Proxy`));
        for (const hostname of ["dns.alidns.com", "doh.pub"]) assert.ok(config.rules.includes(`DOMAIN,${hostname},DIRECT`));
        assert.deepEqual(config.tun?.["dns-hijack"], ["any:53", "tcp://any:53"]);
        assert.equal(config.rules.at(-1), "MATCH,FINAL");
        for (const group of profile.groups) assert.equal(config["proxy-groups"].find(({ name }) => name === group.group).hidden, undefined);
        for (const name of ["AppleProxy", "AppleDirect"]) assert.ok(!config["proxy-groups"].some((group) => group.name === name), name);
        const icloud = config["proxy-groups"].find((group) => group.name === "iCloud");
        assert.deepEqual(icloud.proxies, ["DIRECT", "🇭🇰HK-IDC", "🇺🇸USA-ISP"]);
        assert.ok(!icloud.hidden);
        const wechat = config["proxy-groups"].find((group) => group.name === "WeChat");
        assert.deepEqual(wechat.proxies, ["DIRECT", "🇭🇰HK-IDC", "🇺🇸USA-ISP"]);
        assert.ok(!wechat.hidden);
        assert.equal(wechat.icon, `${ICON_BASE}WeChat.png`);
        assert.ok(config.rules.includes(`RULE-SET,${WECHAT_RULE_ID},WeChat,no-resolve`));
        const wechatProvider = config["rule-providers"][WECHAT_RULE_ID];
        assert.equal(wechatProvider.format, "text");
        assert.equal(wechatProvider.url, WECHAT_URL);
        for (const group of config["proxy-groups"].filter((group) => group.type === "select")) assert.ok(!group.proxies.includes("REJECT"), group.name);
        assert.ok(magicRuleRelay(config["rule-providers"].iCloud.url, "iCloud", "mihomo"));
        const youtube = config["proxy-groups"].find((group) => group.name === "YouTube");
        assert.deepEqual(youtube.proxies, ["🇭🇰HK-IDC", "🇺🇸USA-ISP"]);
        assert.ok(!youtube.hidden);
        assert.equal(youtube.icon, `${ICON_BASE}YouTube.png`);
        assert.ok(config.rules.includes("RULE-SET,YouTube,YouTube,no-resolve"));
        assert.ok(magicRuleRelay(config["rule-providers"].YouTube.url, "YouTube", "mihomo"));
        assert.ok(Object.values(config["rule-providers"]).every(({ url }) => !url.includes(new URL(profile.subscriptionUrl).searchParams.get("token"))));
      } else {
        assert.match(response.headers.get("content-type"), /text\/plain/);
        assert.equal(/^encrypted-dns-server =/m.test(text), doh === "1");
        assert.equal(/^encrypted-dns-follow-outbound-mode = true$/m.test(text), doh === "1");
        assert.ok(text.split("\n").includes(`Auto = smart, include-all-proxies=true, policy-regex-filter=^(?!Tailnet$).*, icon-url=${ICON_BASE}Auto.png`));
        assert.match(text, /^Tailnet = tailscale, section-name=tailnet$/m);
        assert.match(text, /^Tailscale = select, Tailnet$/m);
        assert.match(text, /\[Tailscale tailnet\]\ninteractive-login = true\nauto-add-magic-dns-rule = true\nexit-node = none\n/);
        assert.match(text, /^Proxy = select, 🇺🇸USA-ISP, 🇭🇰HK-IDC, Auto, DIRECT, /m);
        assert.ok(text.split("\n").includes(`FINAL = select, Auto, Proxy, 🇭🇰HK-IDC, 🇺🇸USA-ISP, DIRECT, icon-url=${ICON_BASE}Proxy.png`));
        assert.ok(text.split("\n").includes(`DoH Proxy = smart, 🇭🇰 Example - IDC 1, icon-url=${ICON_BASE}Server.png, hidden=true`));
        assert.doesNotMatch(text, /^PROTOCOL,DOH,/m);
        assert.match(text, /\[Host\]\nzslab\.ai = server:223\.5\.5\.5, 119\.29\.29\.29\n\*\.zslab\.ai = server:223\.5\.5\.5, 119\.29\.29\.29\n/);
        const directDns = doh === "1" ? "https://dns.alidns.com/dns-query, https://doh.pub/dns-query" : "223.5.5.5, 119.29.29.29";
        for (const url of [CUSTOM_DIRECT_URL, DIRECT_URL]) assert.ok(text.split("\n").includes(`RULE-SET:${url} = server:${directDns}`));
        for (const name of ["IBKR", "Direct", "Apple"]) assert.ok(text.split("\n").some((line) => {
          const [, url, servers] = line.match(/^RULE-SET:(\S+) = server:(.+)$/) ?? [];
          return url && magicRuleRelay(url, name, "surge") && servers === directDns;
        }), name);
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
        assert.ok(text.split("\n").includes(`ISP First = select, 🇺🇸USA-ISP, 🇭🇰HK-IDC, icon-url=${ICON_BASE}Global.png`));
        assert.doesNotMatch(text, /^.+ = select,(?:[^\n]*,)?\s*REJECT(?:,|$)/m);
        assert.doesNotMatch(text, /^AppleDirect = /m);
        assert.doesNotMatch(text.split("[Rule]\n")[1], /^RULE-SET,.*hidden=/m);
        const sources = [...text.matchAll(/^RULE-SET,(https:\/\/[^,]+),([^,]+),no-resolve(?:,update-interval=21600)?$/gm)];
        for (const [, value] of sources) {
          if (!REPOSITORY_RULE_SET_URLS.includes(value)) assert.ok(magicRuleRelay(value, "[A-Za-z]+", "surge"), value);
        }
        assert.deepEqual(sources.at(-1).slice(1), [DIRECT_URL, "DIRECT"]);
        assert.deepEqual(sources.map(([, url, policy]) => [REPOSITORY_RULE_SET_URLS.includes(url) ? url : url.match(/\/magicrule\/surge\/([A-Za-z]+)\.list$/)[1], policy]), [
          [CUSTOM_REJECT_URL, "REJECT"], [RED_POCKET_URL, "🇺🇸USA-ISP"], [CUSTOM_DIRECT_URL, "DIRECT"], ["IBKR", "DIRECT"], ["LongBridge", "Proxy"], ["Direct", "DIRECT"], [WECHAT_URL, "WeChat"],
          ["Cloudflare", "AIProxy"], ["OpenAI", "AIProxy"], ["Anthropic", "AIProxy"], ["Gemini", "AIProxy"], ["Grok", "AIProxy"], ["Cursor", "AIProxy"], ["Perplexity", "AIProxy"], [CUSTOM_AI_URL, "AIProxy"], ["AppleIntelligence", "AIProxy"],
          ["AppleTV", "GlobalMedia"], ["iCloud", "iCloud"], ["Apple", "DIRECT"],
          ["Telegram", "Telegram"], ["Twitter", "X"], ["Discord", "Proxy"], ["YouTube", "YouTube"],
          [COIN_URL, "OverseasFinance"], ...["Binance", "OKX", "Bybit", "PayPal", "eBay", "Stripe", "Wise"].map((name) => [name, "OverseasFinance"]),
          ...["Facebook", "Threads", "Reddit", "Line"].map((name) => [name, "ISP First"]),
          ...MEDIA_RULE_NAMES.map((name) => [name, "GlobalMedia"]),
          ["China", "DIRECT"],
        ]);
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
      for (const value of ["oa.com", "*.oa.com", "woa.com", "*.woa.com", "*tencentyun.com", "*workbuddy.cn", "10.0.0.0/7", "21.0.0.0/8", "28.0.0.0/7"]) assert.equal(skip.includes(value), tencentOa === "1");
      for (const value of ["127.0.0.1", "localhost", "*.local", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "www.abchina.com.cn"]) assert.ok(skip.includes(value), value);
      assert.ok(!skip.includes("100.64.0.0/10"));
      assert.equal(skip.includes("10.0.0.0/8"), tencentOa === "0");
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
        assert.equal(config.proxies.filter(({ type }) => type !== "tailscale").length, 3);
        assert.deepEqual(config["proxy-groups"].find((group) => group.name === removed.group).proxies, isp.nodes.map((node) => node.name));
      } else {
        assert.deepEqual(orderedSmartMembers(body, isp.group), isp.nodes.map((node) => node.name));
        assert.match(body, /^FINAL,FINAL,dns-failed$/m);
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
  assert.match(config, /^FINAL,FINAL,dns-failed$/m);
  assert.equal((await request(mf, POOL_IMPORT_PATH, {
    subject: "admin", method: "POST", body: { text: link, nodes: [] }, headers: { origin: "https://foreign.example" },
  })).status, 403);
});

test("admin imports authenticate the protected upstream without exposing service credentials", async (t) => {
  const bindings = {
    NODE_IMPORT_ACCESS_ORIGIN: "https://subscription.example.com",
    NODE_IMPORT_ACCESS_CLIENT_ID: "TEST_ONLY_CLIENT_ID.access",
    NODE_IMPORT_ACCESS_CLIENT_SECRET: "TEST_ONLY_CLIENT_SECRET",
  };
  let calls = 0;
  const mf = new Miniflare(runtimeOptions(undefined, bindings, async (upstream) => {
    calls += 1;
    assert.equal(upstream.url, "https://subscription.example.com/test-only/node");
    assert.equal(upstream.headers.get("CF-Access-Client-Id"), bindings.NODE_IMPORT_ACCESS_CLIENT_ID);
    assert.equal(upstream.headers.get("CF-Access-Client-Secret"), bindings.NODE_IMPORT_ACCESS_CLIENT_SECRET);
    assert.equal(upstream.headers.get("cf-access-jwt-assertion"), null);
    return new Response(nodes(1)[0].line);
  }));
  t.after(() => mf.dispose());
  await initializeDatabase(mf);
  const body = { text: "https://subscription.example.com/test-only/node", nodes: [] };
  for (const subject of [undefined, "alice"]) {
    assert.equal((await request(mf, POOL_IMPORT_PATH, { subject, method: "POST", body })).status, 403);
  }
  assert.equal(calls, 0);
  const draft = await json(await request(mf, POOL_IMPORT_PATH, { subject: "admin", method: "POST", body }));
  assert.equal(calls, 1);
  assert.equal(draft.added, 1);
  assert.doesNotMatch(JSON.stringify(draft), /TEST_ONLY_CLIENT/);
  const page = await (await request(mf, ACCOUNT_PATH, { subject: "admin" })).text();
  assert.doesNotMatch(page, /TEST_ONLY_CLIENT/);
  assert.equal((await json(await request(mf, POOL_STATE_PATH, { subject: "admin" }))).nodes.length, 0);
});

test("incomplete upstream authentication fails closed through the management API", async (t) => {
  const mf = await createRuntime(t, { NODE_IMPORT_ACCESS_ORIGIN: "https://subscription.example.com" });
  const response = await request(mf, POOL_IMPORT_PATH, { subject: "admin", method: "POST",
    body: { text: "https://subscription.example.com/test-only/node", nodes: [] } });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /订阅服务认证未正确配置/);
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
