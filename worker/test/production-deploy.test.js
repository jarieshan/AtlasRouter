import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { deployProduction } from "../scripts/deploy-production.js";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const context = { config, ci: "1", branch: "master", commit: "a".repeat(40), log() {} };

test("Cloudflare master builds migrate both UI databases before publishing production", async () => {
  const calls = [];
  await deployProduction({ ...context, async run(args) { calls.push(args); } });
  assert.deepEqual(calls.slice(0, 2), ["DB", "DEV_DB"].map((binding) =>
    ["d1", "migrations", "apply", binding, "--remote", "--config", "wrangler.jsonc"]));
  assert.deepEqual(calls[2].slice(0, 4), ["deploy", "--config", "wrangler.jsonc", "--secrets-file"]);
  assert.equal(calls.length, 3);
});

test("production refuses non-Cloudflare, non-master and invalid build contexts before remote work", async () => {
  for (const override of [{ ci: undefined }, { ci: "true" }, { branch: "develop" }, { commit: "" }, { ciWorkerName: "another-worker" }]) {
    await assert.rejects(deployProduction({ ...context, ...override, run() { assert.fail("Unexpected remote operation"); } }));
  }
});

test("invalid production UI configuration stops before migrations", async () => {
  for (const change of [
    (value) => { value.d1_databases[1].database_id = value.d1_databases[0].database_id; },
    (value) => { value.vars.UI_ENABLED = "false"; },
    (value) => { value.vars.DEV_SUBSCRIPTION_ORIGIN = "https://atlasrouter.zslab.ai"; },
    (value) => { value.vars.DEV_SUBSCRIPTION_ORIGIN = "https://dev.example/path"; },
  ]) {
    const invalid = structuredClone(config);
    change(invalid);
    await assert.rejects(deployProduction({ ...context, config: invalid, run() { assert.fail("Unexpected remote operation"); } }));
  }
});

test("a development database migration failure prevents production upload", async () => {
  const calls = [];
  await assert.rejects(deployProduction({ ...context, async run(args) {
    calls.push(args);
    if (args[3] === "DEV_DB") throw new Error("migration failed");
  } }), /migration failed/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((args) => args[0] === "d1"));
});

test("local production dry runs never migrate or publish remote resources", async () => {
  const calls = [];
  await deployProduction({ config, dryRun: true, log() {}, async run(args) { calls.push(args); } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("--dry-run"));
});

test("the npm production entrypoint cannot publish from a local shell", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.scripts.deploy, "npm run generate && node scripts/deploy-production.js");
  const script = fileURLToPath(new URL("../scripts/deploy-production.js", import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: "utf8",
    env: { ...process.env, WORKERS_CI: "", WORKERS_CI_BRANCH: "", WORKERS_CI_COMMIT_SHA: "" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only in Cloudflare Workers Builds for master/);
  assert.equal(result.stdout, "");
});
