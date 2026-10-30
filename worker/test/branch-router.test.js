import assert from "node:assert/strict";
import test from "node:test";
import { branchEnvironment, createBranchRouter } from "../src/branch-router.js";
import { inheritBranch, requestBranch } from "../src/branch-query.js";

test("branch selection is explicit and malformed selectors never fall back to production", async () => {
  let calls = 0;
  const app = createBranchRouter(Object.fromEntries(["master", "develop"].map((branch) => [branch, async () => ({
    default: { fetch() { calls += 1; return new Response(branch); } },
  })])));
  const env = { DB: {}, DEV_DB: {} };
  for (const [query, branch] of [["", "master"], ["?dev=0", "master"], ["?dev=1", "develop"]]) {
    assert.equal(await (await app.fetch(new Request(`https://atlas.example/${query}`), env)).text(), branch);
    assert.equal(requestBranch(`https://atlas.example/${query}`), branch);
  }
  for (const query of ["?dev", "?dev=true", "?dev=2", "?dev=1&dev=0", "?dev=1&dev=1"]) {
    assert.equal((await app.fetch(new Request(`https://atlas.example/${query}`), env)).status, 400);
  }
  assert.equal(calls, 3);
  assert.equal(inheritBranch(new URL("https://atlas.example/rules?token=test"), "https://atlas.example/?dev=1").searchParams.get("dev"), "1");
});

test("development never inherits the production database or administrator secrets", () => {
  const env = { DB: {}, DEV_DB: {}, ADMIN_EMAILS: "prod@example.com", DEV_ADMIN_EMAILS: "dev@example.com",
    ADMIN_API_SLUG: "production", DEV_ADMIN_API_SLUG: "development", ACCESS_AUD: "shared", FEATURE: "prod", DEV_FEATURE: "dev" };
  const production = branchEnvironment(env, "master");
  const development = branchEnvironment(env, "develop");
  assert.equal(production.DB, env.DB);
  assert.equal(development.DB, env.DEV_DB);
  assert.equal(development.ADMIN_EMAILS, "dev@example.com");
  assert.equal(development.ADMIN_API_SLUG, "development");
  assert.equal(development.FEATURE, "dev");
  assert.equal(development.ACCESS_AUD, "shared");
  assert.ok(Object.keys(production).every((key) => !key.startsWith("DEV_")));
  assert.ok(!Object.values(development).includes(env.DB));
  assert.throws(() => branchEnvironment({ DB: {} }, "develop"), /database is not configured/);
  assert.equal(branchEnvironment({ DB: {}, DEV_DB: {}, ADMIN_EMAILS: "prod@example.com" }, "develop").ADMIN_EMAILS, undefined);
});

test("a development module initialization failure leaves the production handler usable", async () => {
  const app = createBranchRouter({
    master: async () => ({ default: { fetch: () => new Response("stable") } }),
    develop: async () => { throw new Error("private implementation failure"); },
  });
  const env = { DB: {}, DEV_DB: {} };
  const broken = await app.fetch(new Request("https://atlas.example/?dev=1"), env);
  assert.equal(broken.status, 500);
  assert.equal(await broken.text(), "Internal Server Error");
  assert.equal(await (await app.fetch(new Request("https://atlas.example/"), env)).text(), "stable");
});
