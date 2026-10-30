import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deployPreview } from "../scripts/deploy-preview.js";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const options = { config, branch: "develop", ciWorkerName: "atlas-router", log() {} };

test("Preview deployment migrates only development D1 and publishes only the develop Preview", async () => {
  const calls = [];
  await deployPreview({ ...options, run: async (args) => calls.push(args) });
  assert.deepEqual(calls, [
    ["d1", "migrations", "apply", "DEV_DB", "--remote", "--config", "wrangler.jsonc"],
    ["preview", "--name", "develop", "--config", "wrangler.jsonc", "--ignore-base-config"],
  ]);
});

test("other branches and Preview dry runs do not touch remote resources", async () => {
  const run = () => assert.fail("must not invoke Wrangler");
  for (const branch of ["master", "main", "feature/example", "", undefined]) {
    assert.equal((await deployPreview({ ...options, branch, run })).skipped, true);
  }
  assert.equal((await deployPreview({ ...options, dryRun: true, run })).dryRun, true);
});

test("invalid Preview isolation or target stops before running a migration", async () => {
  const mutations = [
    (c) => { c.name = "another-worker"; },
    (c) => { c.main = ".wrangler/branches/index.js"; },
    (c) => { c.d1_databases.find((db) => db.binding === "DEV_DB").database_id = c.d1_databases.find((db) => db.binding === "DB").database_id; },
    (c) => { c.previews.d1_databases[0].database_id = "wrong-database"; },
    (c) => { c.previews.d1_databases[0].database_name = "wrong-database"; },
    (c) => { c.previews.d1_databases.push(c.d1_databases[0]); },
    (c) => { c.previews.d1_databases[0].migrations_dir = "../production-migrations"; },
    (c) => { c.previews.vars.UI_ENABLED = "true"; },
    (c) => { c.previews.vars.SUBSCRIPTION_PATH = "/AtlasRouter"; },
  ];
  const run = () => assert.fail("must not invoke Wrangler");
  for (const mutate of mutations) {
    const altered = structuredClone(config);
    mutate(altered);
    await assert.rejects(() => deployPreview({ ...options, config: altered, run }));
  }
  await assert.rejects(() => deployPreview({ ...options, ciWorkerName: "wrong-worker", run }));
});

test("a failed development migration prevents the Preview upload", async () => {
  const calls = [];
  await assert.rejects(() => deployPreview({ ...options, run: async (args) => {
    calls.push(args[0]);
    throw new Error("migration failed");
  } }), /migration failed/);
  assert.deepEqual(calls, ["d1"]);
});
