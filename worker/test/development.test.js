import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { developmentAvailable, developmentPage, developmentRequest } from "../src/development.js";
import { INTERNAL_ACCOUNT_PAGE_PATH } from "../src/routes.js";
import { handleRequest } from "../src/index.js";
import { uiEnvironment } from "../src/ui-environment.js";
import { deployDevelopment } from "../scripts/deploy-development.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("Dev selects only its own database and generates a subscription using its path", () => {
  const env = { DB: {}, DEV_DB: {}, DEV_SUBSCRIPTION_SERVICE: { fetch() {} } };
  const target = uiEnvironment("https://atlas.example/?environment=development&client=clash", env);
  assert.equal(target.env.DB, env.DEV_DB);
  assert.equal(target.subscriptionBase, "https://atlas.example/AtlasRouter-Dev");
  assert.equal(uiEnvironment("https://atlas.example/api/AtlasRouter-Dev/account/profile", env).env.DB, env.DEV_DB);
  assert.equal(uiEnvironment("https://atlas.example/", env).env, env);
  for (const invalid of [{ ...env, DEV_DB: env.DB }, { ...env, DEV_DB: undefined }, { ...env, DEV_SUBSCRIPTION_SERVICE: undefined }]) {
    assert.equal(developmentAvailable(invalid), false);
    assert.throws(() => uiEnvironment("https://atlas.example/?environment=development", invalid), { status: 503 });
  }
});

test("development page forwarding sends only the verified rendering context", async () => {
  const context = { adminApiSlug: null, preview: false, previewIdentity: false };
  let calls = 0;
  const env = { DEV_SUBSCRIPTION_SERVICE: { async fetch(request) {
    calls += 1;
    const url = new URL(request.url);
    assert.equal(url.pathname, INTERNAL_ACCOUNT_PAGE_PATH);
    assert.equal(url.search, "");
    assert.equal(request.method, "POST");
    assert.equal(request.redirect, "manual");
    assert.deepEqual([...request.headers], [["content-type", "application/json"], ["origin", url.origin]]);
    assert.deepEqual(await request.json(), context);
    return new Response("Development HTML", { headers: {
      "content-type": "text/html; charset=utf-8", "x-atlasrouter-page-environment": "development",
    } });
  } } };
  const response = await developmentPage(new Request("https://atlas.example/?environment=development&role=admin", {
    headers: { cookie: "TEST_ONLY", authorization: "TEST_ONLY", "cf-access-jwt-assertion": "TEST_ONLY" },
  }), env, context);
  assert.equal(await response.text(), "Development HTML");
  assert.equal(calls, 1);
});

test("unavailable or incompatible development pages fail closed", async () => {
  for (const fetch of [
    async () => new Response("Not Found", { status: 404 }),
    async () => new Response("Old page", { headers: { "content-type": "text/html" } }),
    async () => new Response("Wrong page", { headers: { "content-type": "text/html", "x-atlasrouter-page-environment": "production" } }),
    async () => Response.json({}),
    async () => { throw new Error("Service unavailable"); },
  ]) {
    await assert.rejects(developmentPage(new Request("https://atlas.example/?environment=development"), {
      DEV_SUBSCRIPTION_SERVICE: { fetch },
    }, { adminApiSlug: null, preview: false, previewIdentity: false }), { status: 503 });
  }
});

test("private page rendering validates the role context and is disabled on production", async () => {
  const origin = "https://atlas.example";
  for (const context of [
    {},
    { adminApiSlug: '"</script>', preview: false, previewIdentity: false },
    { adminApiSlug: null, preview: false, previewIdentity: true },
    { adminApiSlug: null, preview: "false", previewIdentity: false },
  ]) {
    const response = await handleRequest(new Request(origin + INTERNAL_ACCOUNT_PAGE_PATH, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(context),
    }), { SUBSCRIPTION_VARIANT: "development", UI_ENABLED: "false" });
    assert.equal(response.status, 400);
  }
  const response = await handleRequest(new Request(origin + INTERNAL_ACCOUNT_PAGE_PATH, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ adminApiSlug: null, preview: false, previewIdentity: false }),
  }), { SUBSCRIPTION_VARIANT: "production" });
  assert.equal(response.status, 404);
});

test("private Dev forwarding excludes browser and Access credentials and rejects management requests", async () => {
  let calls = 0;
  const env = { DB: {}, DEV_DB: {}, DEV_SUBSCRIPTION_SERVICE: { async fetch(request) {
    calls += 1;
    assert.equal(new URL(request.url).pathname, "/AtlasRouter-Dev");
    assert.equal(new URL(request.url).searchParams.get("dev"), null);
    assert.deepEqual([...request.headers], [["accept", "text/plain"]]);
    return new Response("development");
  } } };
  const response = await developmentRequest(new Request("https://atlas.example/AtlasRouter?dev=1&token=TEST_ONLY", {
    headers: { accept: "text/plain", cookie: "TEST_ONLY", authorization: "TEST_ONLY", "cf-access-jwt-assertion": "TEST_ONLY" },
  }), env);
  assert.equal(await response.text(), "development");
  for (const path of ["/", "/api/account/profile", "/missing", INTERNAL_ACCOUNT_PAGE_PATH]) {
    await assert.rejects(developmentRequest(new Request(`https://atlas.example${path}?dev=1`), env), { status: 404 });
  }
  await assert.rejects(developmentRequest(new Request("https://atlas.example/AtlasRouter?dev=1", { method: "POST" }), env), { status: 405 });
  await assert.rejects(developmentRequest(new Request("https://atlas.example/AtlasRouter?dev=1&dev=0"), env), { status: 400 });
  assert.equal(await developmentRequest(new Request("https://atlas.example/AtlasRouter"), env), null);
  assert.equal(calls, 1);
});

test("private development deployment cannot expose a public route or use production data", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.development.jsonc", import.meta.url), "utf8"));
  const production = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const calls = [];
  const context = { config, production, ci: "1", branch: "develop", commit: "a".repeat(40), ciWorkerName: config.name,
    async run(args) { calls.push(args); } };
  await deployDevelopment(context);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.development.jsonc"]);
  for (const override of [{ ci: undefined }, { branch: "master" }, { commit: "" }, { ciWorkerName: "atlas-router" }, { ciWorkerName: "another-worker" }]) {
    await assert.rejects(deployDevelopment({ ...context, ...override, run() { assert.fail("No remote work"); } }), /Development/);
  }
  for (const change of [
    (c) => { c.workers_dev = true; },
    (c) => { c.routes = [{ pattern: "*.example.com" }]; },
    (c) => { c.d1_databases[0].database_id = production.d1_databases[0].database_id; },
    (c) => { c.vars.SUBSCRIPTION_VARIANT = "production"; },
    (c) => { c.vars.REPOSITORY_RULES_REF = "master"; },
    (c) => { delete c.vars.REPOSITORY_RULES_REF; },
  ]) {
    const invalid = structuredClone(config);
    change(invalid);
    await assert.rejects(deployDevelopment({ ...context, config: invalid, run() { assert.fail("No remote work"); } }), /Development/);
  }
});

test("the development entrypoint rejects a mismatched Cloudflare Worker target", () => {
  const script = fileURLToPath(new URL("../scripts/deploy-development.js", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--dry-run"], { encoding: "utf8",
    env: { ...process.env, WORKERS_CI: "1", WORKERS_CI_BRANCH: "develop", WORKERS_CI_COMMIT_SHA: "a".repeat(40),
      WRANGLER_CI_OVERRIDE_NAME: "atlas-router" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /private subscription Worker/);
  assert.equal(result.stdout, "");
});

test("development deployment migrates the test database before deploying and dry runs only build", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.development.jsonc", import.meta.url), "utf8"));
  const production = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const calls = [];
  await deployDevelopment({ config, production, ci: "1", branch: "develop", commit: "a".repeat(40),
    async run(args) { calls.push(args); } });
  assert.deepEqual(calls, [
    ["d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.development.jsonc"],
    ["deploy", "--config", "wrangler.development.jsonc"],
  ]);
  const dryRunCalls = [];
  await deployDevelopment({ config, production, dryRun: true, async run(args) { dryRunCalls.push(args); } });
  assert.deepEqual(dryRunCalls, [["deploy", "--config", "wrangler.development.jsonc", "--dry-run"]]);
});
