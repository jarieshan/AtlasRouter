import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertBranchDeployment, deployBranches } from "../scripts/deploy-branches.js";

const config = JSON.parse(await readFile(new URL("../wrangler.branches.jsonc", import.meta.url), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const refs = { master: "a".repeat(40), develop: "b".repeat(40) };
const source = "export default { fetch() { return new Response('test'); } };\n";
const sql = "CREATE TABLE test (name TEXT);\n";
const manifest = { version: 1, verified: true, refs, contracts: { master: true, develop: true },
  bundleSha256: sha256(source), migrations: Object.fromEntries(["master", "develop"].map((name) =>
    [name, { "0001.sql": sha256(sql) }])) };

async function artifact(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "atlas-deploy-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, ".wrangler/branches");
  for (const branch of ["master", "develop"]) {
    await mkdir(path.join(output, branch, "migrations"), { recursive: true });
    await writeFile(path.join(output, branch, "migrations/0001.sql"), sql);
  }
  await writeFile(path.join(output, "index.js"), source);
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest));
  const configFile = path.join(directory, "wrangler.branches.jsonc");
  await writeFile(configFile, JSON.stringify(config));
  return { artifact: output, configFile, env: {}, remoteHeads: async () => refs, log() {} };
}

test("branch deployment requires the shared Worker, independent databases and verified branch snapshots", () => {
  for (const branch of ["master", "develop"]) {
    const env = { WORKERS_CI: "1", WRANGLER_CI_OVERRIDE_NAME: "atlas-router", WORKERS_CI_BRANCH: branch,
      WORKERS_CI_COMMIT_SHA: refs[branch] };
    assert.doesNotThrow(() => assertBranchDeployment(config, manifest, branch, env));
    for (const changed of [
      { ...env, WRANGLER_CI_OVERRIDE_NAME: "atlas-router-dev" },
      { ...env, WORKERS_CI_BRANCH: "main" },
      { ...env, WORKERS_CI_COMMIT_SHA: "c".repeat(40) },
    ]) assert.throws(() => assertBranchDeployment(config, manifest, branch, changed));
  }
  for (const changed of [
    { ...config, name: "atlas-router-dev" },
    { ...config, main: "src/index.js" },
    { ...config, d1_databases: config.d1_databases.map((db) => ({ ...db, database_id: "same-db" })) },
    { ...config, d1_databases: config.d1_databases.map((db) => ({ ...db, migrations_dir: "migrations" })) },
  ]) assert.throws(() => assertBranchDeployment(changed, manifest, "develop", {}));
  for (const changed of [
    { ...manifest, verified: false }, { ...manifest, refs: { develop: refs.develop } },
    { ...manifest, contracts: { ...manifest.contracts, master: false } },
  ]) assert.throws(() => assertBranchDeployment(config, changed, "develop", {}));
  assert.throws(() => assertBranchDeployment(config, manifest, "main", {}));
});

test("each branch migrates and rotates only its own settings in the same Worker", async (t) => {
  const options = await artifact(t);
  for (const branch of ["master", "develop"]) {
    const calls = [];
    let secretsFile;
    await deployBranches({ ...options, branch, async run(args, secret) {
      calls.push(args);
      assert.equal(args[args.indexOf("--config") + 1], options.configFile);
      if (args[1] === "migrations") {
        assert.equal(args[3], branch === "master" ? "DB" : "DEV_DB");
      } else if (args[1] === "execute") {
        assert.equal(args[2], branch === "master" ? "DEV_DB" : "DB");
        assert.equal(args[args.indexOf("--command") + 1], "SELECT name FROM d1_migrations");
        return JSON.stringify([{ success: true, results: [{ name: "0001.sql" }] }]);
      } else {
        assert.equal(args[0], "deploy");
        secretsFile = args[args.indexOf("--secrets-file") + 1];
        assert.deepEqual(JSON.parse(await readFile(secretsFile, "utf8")),
          { [branch === "master" ? "ADMIN_API_SLUG" : "DEV_ADMIN_API_SLUG"]: secret });
      }
    } });
    assert.deepEqual(calls.map((args) => args.slice(0, 2)), [["d1", "migrations"], ["d1", "execute"], ["deploy", "--config"]]);
    await assert.rejects(() => stat(secretsFile), { code: "ENOENT" });
  }
});

test("stale or modified artifacts never start remote changes", async (t) => {
  const options = await artifact(t);
  const run = () => assert.fail("must reject before Wrangler");
  await assert.rejects(() => deployBranches({ ...options, branch: "develop", run,
    remoteHeads: async () => ({ ...refs, master: "c".repeat(40) }) }), /heads changed/);
  await writeFile(path.join(options.artifact, "index.js"), source + "// changed\n");
  await assert.rejects(() => deployBranches({ ...options, branch: "develop", run }), /bundle changed/);
  await writeFile(path.join(options.artifact, "index.js"), source);
  await writeFile(path.join(options.artifact, "master/migrations/0001.sql"), sql + "-- changed\n");
  await assert.rejects(() => deployBranches({ ...options, branch: "develop", run }), /migrations changed/);
});

test("pending migrations in the other database prevent publishing either implementation", async (t) => {
  const options = await artifact(t);
  const calls = [];
  await assert.rejects(() => deployBranches({ ...options, branch: "develop", async run(args) {
    calls.push(args.slice(0, 2));
    if (args[1] === "migrations") assert.equal(args[3], "DEV_DB");
    else if (args[1] === "execute") return JSON.stringify([{ success: true, results: [] }]);
    else assert.fail("must not upload code or Secrets");
  } }), /master has pending migrations/);
  assert.deepEqual(calls, [["d1", "migrations"], ["d1", "execute"]]);
});

test("branch movement during migrations aborts before upload; dry-run never touches remote data", async (t) => {
  const options = await artifact(t);
  let reads = 0;
  await assert.rejects(() => deployBranches({ ...options, branch: "develop",
    remoteHeads: async () => ++reads === 1 ? refs : { ...refs, develop: "c".repeat(40) },
    async run(args) {
      if (args[1] === "execute") return JSON.stringify([{ success: true, results: [{ name: "0001.sql" }] }]);
      assert.equal(args[1], "migrations");
    },
  }), /heads changed/);
  await writeFile(path.join(options.artifact, "manifest.json"), JSON.stringify({ ...manifest, contracts: { master: false } }));
  await deployBranches({ ...options, dryRun: true,
    remoteHeads: () => assert.fail("dry-run must not fetch remote branches"),
    async run(args) {
      assert.equal(args[0], "deploy");
      assert.ok(args.includes("--dry-run"));
    },
  });
});
