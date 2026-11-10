import assert from "node:assert/strict";
import test from "node:test";
import { developmentAvailable, developmentRequest } from "../src/development.js";
import { uiEnvironment } from "../src/ui-environment.js";
import { deployDevelopment } from "../scripts/deploy-development.js";
import { readFile } from "node:fs/promises";

test("Dev selects only its own database and generates a same-origin development subscription", () => {
  const env = { DB: {}, DEV_DB: {}, DEV_SUBSCRIPTION_SERVICE: { fetch() {} } };
  const target = uiEnvironment("https://atlas.example/?environment=development&client=clash", env);
  assert.equal(target.env.DB, env.DEV_DB);
  assert.equal(target.subscriptionBase, "https://atlas.example/AtlasRouter?dev=1");
  assert.equal(uiEnvironment("https://atlas.example/", env).env, env);
  for (const invalid of [{ ...env, DEV_DB: env.DB }, { ...env, DEV_DB: undefined }, { ...env, DEV_SUBSCRIPTION_SERVICE: undefined }]) {
    assert.equal(developmentAvailable(invalid), false);
    assert.throws(() => uiEnvironment("https://atlas.example/?environment=development", invalid), { status: 503 });
  }
});

test("private Dev forwarding excludes browser and Access credentials and rejects management requests", async () => {
  let calls = 0;
  const env = { DB: {}, DEV_DB: {}, DEV_SUBSCRIPTION_SERVICE: { async fetch(request) {
    calls += 1;
    assert.equal(new URL(request.url).searchParams.get("dev"), "1");
    assert.deepEqual([...request.headers], [["accept", "text/plain"]]);
    return new Response("development");
  } } };
  const response = await developmentRequest(new Request("https://atlas.example/AtlasRouter?dev=1&token=TEST_ONLY", {
    headers: { accept: "text/plain", cookie: "TEST_ONLY", authorization: "TEST_ONLY", "cf-access-jwt-assertion": "TEST_ONLY" },
  }), env);
  assert.equal(await response.text(), "development");
  for (const path of ["/", "/api/account/profile", "/missing"]) {
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
  const context = { config, production, ci: "1", branch: "develop", commit: "a".repeat(40), async run(args) { calls.push(args); } };
  await deployDevelopment(context);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["d1", "migrations", "apply", "DB", "--remote", "--config", "wrangler.development.jsonc"]);
  for (const change of [
    (c) => { c.workers_dev = true; },
    (c) => { c.routes = [{ pattern: "*.example.com" }]; },
    (c) => { c.d1_databases[0].database_id = production.d1_databases[0].database_id; },
    (c) => { c.vars.SUBSCRIPTION_VARIANT = "production"; },
  ]) {
    const invalid = structuredClone(config);
    change(invalid);
    await assert.rejects(deployDevelopment({ ...context, config: invalid, run() { assert.fail("No remote work"); } }));
  }
});
