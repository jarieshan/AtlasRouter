import assert from "node:assert/strict";
import test from "node:test";
import { setupBuilds } from "../scripts/setup-builds.js";

const account = "a".repeat(32);
const workerTag = "b".repeat(32);
const buildId = "11111111-1111-4111-8111-111111111111";
const triggerId = "22222222-2222-4222-8222-222222222222";
const env = { WORKERS_CI: "1", WRANGLER_CI_OVERRIDE_NAME: "atlas-router", WORKERS_CI_BRANCH: "develop",
  WORKERS_CI_BUILD_UUID: buildId, WORKERS_CI_COMMIT_SHA: "c".repeat(40), CLOUDFLARE_ACCOUNT_ID: account };
const dryRunCommand = "npm run deploy:branches -- --dry-run";
const initial = {
  trigger_uuid: triggerId, external_script_id: workerTag,
  repo_connection: { provider_type: "github", provider_account_name: "jarieshan", repo_name: "AtlasRouter" },
  branch_includes: ["develop"], branch_excludes: [], root_directory: "worker",
  build_command: "npm ci && npm run build:branches && npm run setup:builds",
  deploy_command: dryRunCommand, path_includes: ["*"], path_excludes: [],
};

function fixture() {
  const state = {
    trigger: structuredClone(initial),
    build: { build_uuid: buildId, trigger: { external_script_id: workerTag, trigger_uuid: triggerId },
      build_trigger_metadata: { branch: "develop", commit_hash: env.WORKERS_CI_COMMIT_SHA,
        deploy_command: dryRunCommand, build_trigger_source: "push" } },
    accounts: [{ id: account }], calls: [], logs: [],
  };
  const options = { env: { ...env }, readToken: async () => "test-only-credential", log: (message) => state.logs.push(message),
    async fetcher(url, request) {
      assert.equal(request.headers.Authorization, "Bearer test-only-credential");
      assert.equal(request.redirect, "error");
      const route = new URL(url).pathname.replace("/client/v4", "");
      const body = request.body ? JSON.parse(request.body) : undefined;
      state.calls.push({ route, method: request.method, body });
      if (state.fail) return Response.json({ success: false, errors: [{ message: "test-only-credential private-body" }] }, { status: 403 });
      let result;
      if (route === "/accounts") result = state.accounts;
      else if (route === `/accounts/${account}/workers/scripts`) result = [{ id: "atlas-router", tag: workerTag }];
      else if (route === `/accounts/${account}/builds/builds/${buildId}`) result = state.build;
      else if (route === `/accounts/${account}/builds/workers/${workerTag}/triggers`) {
        result = [state.trigger, { trigger_uuid: "33333333-3333-4333-8333-333333333333", deploy_command: "npx wrangler preview" }];
      } else if (route === `/accounts/${account}/builds/triggers/${triggerId}` && request.method === "PATCH") {
        if (!state.ignoreUpdate) Object.assign(state.trigger, body);
        result = state.trigger;
      } else assert.fail(`Unexpected request: ${route}`);
      return Response.json({ success: true, result });
    },
  };
  return { state, options };
}

test("setup changes only the current trigger, verifies both branches, and keeps deployments paused", async () => {
  const { state, options } = fixture();
  assert.deepEqual(await setupBuilds(options), { changed: true });
  const writes = state.calls.filter((call) => call.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].route, `/accounts/${account}/builds/triggers/${triggerId}`);
  assert.deepEqual(writes[0].body.branch_includes, ["master", "develop"]);
  assert.deepEqual(writes[0].body.branch_excludes, []);
  assert.equal(writes[0].body.deploy_command, dryRunCommand);
  assert.equal(writes[0].body.build_command, "npm ci && npm run build:branches");
  assert.equal(state.calls.at(-1).method, "GET");
  assert.equal(state.calls.at(-1).route, `/accounts/${account}/builds/workers/${workerTag}/triggers`);
  assert.match(state.logs[0], /master \+ develop/);
  assert.ok(!state.logs.join("\n").includes("test-only-credential"));
  state.calls.length = 0;
  state.trigger.branch_includes.reverse();
  state.trigger.root_directory = "/worker/";
  assert.deepEqual(await setupBuilds(options), { changed: false });
  assert.ok(state.calls.every((call) => call.method === "GET"));
});

test("local execution and unrelated build contexts stop before reading credentials", async () => {
  for (const changed of [
    { WORKERS_CI: undefined }, { WRANGLER_CI_OVERRIDE_NAME: "another-worker" },
    { WORKERS_CI_BRANCH: "master" }, { WORKERS_CI_BUILD_UUID: "../elsewhere" }, { WORKERS_CI_COMMIT_SHA: "missing" },
  ]) {
    const { state, options } = fixture();
    options.env = { ...env, ...changed };
    options.readToken = () => assert.fail("must not read credentials");
    await assert.rejects(() => setupBuilds(options), /inside atlas-router Cloudflare Builds on develop/);
    assert.equal(state.calls.length, 0);
  }
});

test("publishing, pull-request, stale and mismatched build records never modify triggers", async () => {
  const changes = [
    (build) => { build.build_uuid = triggerId; },
    (build) => { build.trigger.external_script_id = "d".repeat(32); },
    (build) => { build.trigger.trigger_uuid = "../elsewhere"; },
    (build) => { build.build_trigger_metadata.branch = "master"; },
    (build) => { build.build_trigger_metadata.commit_hash = "e".repeat(40); },
    (build) => { build.build_trigger_metadata.deploy_command = "npm run deploy:branches"; },
    (build) => { build.build_trigger_metadata.build_trigger_source = "pull_request"; },
  ];
  for (const change of changes) {
    const { state, options } = fixture();
    change(state.build);
    await assert.rejects(() => setupBuilds(options), /running build must be a develop dry-run/);
    assert.ok(state.calls.every((call) => call.method === "GET"));
  }
});

test("changed trigger ownership or deploy settings stop setup before any update", async () => {
  const changes = [
    { external_script_id: "d".repeat(32) }, { deleted_on: "2026-01-01" },
    { deploy_command: "npm run deploy:branches" }, { root_directory: "other" },
    { repo_connection: { ...initial.repo_connection, provider_account_name: "other-owner" } },
    { repo_connection: { ...initial.repo_connection, repo_name: "other-repo" } },
  ];
  for (const change of changes) {
    const { state, options } = fixture();
    Object.assign(state.trigger, change);
    await assert.rejects(() => setupBuilds(options), /current trigger must target/);
    assert.ok(state.calls.every((call) => call.method === "GET"));
  }
});

test("setup discovers a single account and refuses to guess between accounts", async () => {
  const { state, options } = fixture();
  delete options.env.CLOUDFLARE_ACCOUNT_ID;
  state.accounts.push({ id: "d".repeat(32) });
  await assert.rejects(() => setupBuilds(options), /CLOUDFLARE_ACCOUNT_ID/);
  assert.equal(state.calls.length, 1);
  state.accounts.pop();
  assert.deepEqual(await setupBuilds(options), { changed: true });
});

test("permission and transport failures never reveal credentials or raw responses", async () => {
  const { state, options } = fixture();
  state.fail = true;
  await assert.rejects(() => setupBuilds(options), (error) => {
    assert.match(error.message, /Workers Builds Configuration > Edit/);
    assert.doesNotMatch(error.message, /test-only-credential|private-body/);
    return true;
  });
  assert.equal(state.calls.length, 1);
  options.fetcher = async () => { throw new Error("test-only-credential private-body"); };
  await assert.rejects(() => setupBuilds(options), (error) => {
    assert.doesNotMatch(error.message, /test-only-credential|private-body/);
    return true;
  });
  assert.equal(state.logs.length, 0);
});

test("an accepted update is not reported successful unless readback confirms the configuration", async () => {
  const { state, options } = fixture();
  state.ignoreUpdate = true;
  await assert.rejects(() => setupBuilds(options), /Could not confirm both branches/);
  assert.equal(state.logs.length, 0);
  assert.equal(state.calls.filter((call) => call.method === "PATCH").length, 1);
});
