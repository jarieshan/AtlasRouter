import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parse as parseYaml } from "yaml";
import { assertDevelopmentIsolation, deploy, deployAll, deployDevelopment, deploySpeedtest } from "../scripts/deploy.js";

const speedtestConfig = fileURLToPath(new URL("../../speedtest-worker/wrangler.jsonc", import.meta.url));
const developmentConfig = fileURLToPath(new URL("../wrangler.dev.jsonc", import.meta.url));

test("development deployment rejects production Worker, domain and database bindings", async () => {
  const development = JSON.parse(await readFile(developmentConfig, "utf8"));
  const production = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.doesNotThrow(() => assertDevelopmentIsolation(development, production));
  for (const change of [
    { name: production.name },
    { routes: production.routes },
    { routes: production.routes.map((route) => route.pattern) },
    { routes: [{ pattern: "ATLASROUTER.ZSLAB.AI", custom_domain: true }] },
    { routes: [{ pattern: "*.zslab.ai/*", custom_domain: false }] },
    { routes: [null] },
    { routes: [] },
    { d1_databases: production.d1_databases },
    { d1_databases: [...development.d1_databases, { ...production.d1_databases[0], binding: "OTHER_DB" }] },
    { d1_databases: [] },
  ]) assert.throws(() => assertDevelopmentIsolation({ ...development, ...change }, production), /own Worker, domains and D1/);
});

test("development migrations and deployment always target its own config and never deploy speedtest", async () => {
  for (const dryRun of [false, true]) {
    const calls = [];
    let file;
    await deployDevelopment({
      dryRun, log() {},
      async run(args, secret) {
        calls.push(args);
        assert.equal(args[args.indexOf("--config") + 1], developmentConfig);
        if (args[0] === "d1") {
          assert.deepEqual(args, ["d1", "migrations", "apply", "DB", "--remote", "--config", developmentConfig]);
          assert.equal(secret, undefined);
          return;
        }
        file = args[args.indexOf("--secrets-file") + 1];
        assert.equal(JSON.parse(await readFile(file, "utf8")).ADMIN_API_SLUG, secret);
        assert.equal(args.includes("--dry-run"), dryRun);
      },
    });
    assert.deepEqual(calls.map((args) => args[0]), dryRun ? ["deploy"] : ["d1", "deploy"]);
    await assert.rejects(() => stat(file), { code: "ENOENT" });
  }
});

test("GitHub deployment selection keeps develop, master, pull requests and other branches separate", async () => {
  const workflow = parseYaml(await readFile(new URL("../../.github/workflows/worker.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on.push.branches, ["develop", "master"]);
  const development = workflow.jobs["deploy-development"];
  const production = workflow.jobs["deploy-production"];
  for (const [ref, event_name, expected] of [
    ["refs/heads/develop", "push", "development"],
    ["refs/heads/master", "push", "production"],
    ["refs/heads/develop", "workflow_dispatch", "development"],
    ["refs/heads/master", "workflow_dispatch", "production"],
    ["refs/heads/main", "push", null],
    ["refs/heads/feature/test", "workflow_dispatch", null],
    ["refs/heads/develop", "pull_request", null],
    ["refs/heads/master", "pull_request", null],
    ["refs/pull/1/merge", "pull_request", null],
  ]) {
    const selected = [development, production].filter((job) => runInNewContext(job.if, { github: { ref, event_name } }));
    assert.deepEqual(selected.map((job) => job.environment), expected ? [expected] : []);
  }
  assert.equal(workflow.jobs.verify.environment, undefined);
  assert.ok(!JSON.stringify(workflow.jobs.verify).includes("secrets."));
  for (const [job, command] of [[development, "npm run deploy:dev"], [production, "npm run deploy"]]) {
    assert.equal(job.needs, "verify");
    assert.equal(job.concurrency["cancel-in-progress"], false);
    assert.ok(job.steps.some((step) => step.run === command));
  }
  assert.notEqual(development.concurrency.group, production.concurrency.group);
});

test("deployments generate fresh valid route Secrets, including when no usable value exists", async () => {
  const seen = new Set();
  for (const existing of [undefined, "", "invalid", "0".repeat(32)]) {
    let current = existing;
    let file;
    const calls = [];
    const logs = [];
    await deploy({
      log: (line) => logs.push(line),
      async run(args, secret) {
        calls.push(args[0]);
        if (args[0] === "d1") {
          assert.deepEqual(args, ["d1", "migrations", "apply", "DB", "--remote"]);
          assert.equal(current, existing, "the current route must not change before migration succeeds");
          return;
        }
        assert.deepEqual(calls, ["d1", "deploy"]);
        assert.deepEqual(args.slice(0, 2), ["deploy", "--secrets-file"]);
        file = args[2];
        assert.equal((await stat(file)).mode & 0o777, 0o600);
        assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
        const payload = JSON.parse(await readFile(file, "utf8"));
        assert.deepEqual(Object.keys(payload), ["ADMIN_API_SLUG"], "unrelated Secrets must not be overwritten");
        assert.match(payload.ADMIN_API_SLUG, /^[a-f0-9]{32}$/);
        assert.notEqual(payload.ADMIN_API_SLUG, existing);
        assert.equal(payload.ADMIN_API_SLUG, secret, "the runner must redact the uploaded Secret");
        assert.ok(!args.join(" ").includes(secret), "the Secret must not be a command-line argument");
        current = payload.ADMIN_API_SLUG;
      },
    });
    assert.ok(!seen.has(current));
    seen.add(current);
    assert.ok(!logs.join("\n").includes(current));
    await assert.rejects(() => stat(path.dirname(file)), { code: "ENOENT" });
  }
});

test("migration failure stops before generating or uploading a new route", async () => {
  const calls = [];
  await assert.rejects(() => deploy({
    log() {},
    async run(args) {
      calls.push(args[0]);
      throw new Error("migration failed");
    },
  }), /migration failed/);
  assert.deepEqual(calls, ["d1"]);
});

test("failed uploads still remove the temporary Secret file", async () => {
  let file;
  await assert.rejects(() => deploy({
    log() {},
    async run(args) {
      if (args[0] === "d1") return;
      file = args[2];
      await stat(file);
      throw new Error("upload failed");
    },
  }), /upload failed/);
  await assert.rejects(() => stat(path.dirname(file)), { code: "ENOENT" });
});

test("dry runs validate the Secret upload without applying remote migrations", async () => {
  const calls = [];
  let file;
  await deploy({
    dryRun: true,
    log() {},
    async run(args) {
      calls.push(args);
      assert.deepEqual(args.slice(0, 3), ["deploy", "--dry-run", "--secrets-file"]);
      file = args[3];
      assert.match(JSON.parse(await readFile(file, "utf8")).ADMIN_API_SLUG, /^[a-f0-9]{32}$/);
    },
  });
  assert.equal(calls.length, 1);
  await assert.rejects(() => stat(path.dirname(file)), { code: "ENOENT" });
});

test("combined deployment publishes the router before speedtest without sharing its Secret", async () => {
  const calls = [];
  let secretsFile;
  await deployAll({
    log() {},
    async run(args, secret) {
      if (args[0] === "d1") {
        calls.push("migrate");
      } else if (args.includes("--secrets-file")) {
        calls.push("router");
        secretsFile = args[args.indexOf("--secrets-file") + 1];
        assert.match(secret, /^[a-f0-9]{32}$/);
      } else {
        calls.push("speedtest");
        assert.deepEqual(args, ["deploy", "--config", speedtestConfig]);
        assert.equal(secret, undefined);
        await assert.rejects(() => stat(secretsFile), { code: "ENOENT" });
      }
    },
  });
  assert.deepEqual(calls, ["migrate", "router", "speedtest"]);
});

test("combined deployment stops if migration or router publication fails", async () => {
  for (const failure of ["migrate", "router"]) {
    const calls = [];
    await assert.rejects(() => deployAll({
      log() {},
      async run(args) {
        const step = args[0] === "d1" ? "migrate" : args.includes("--secrets-file") ? "router" : "speedtest";
        calls.push(step);
        if (step === failure) throw new Error(`${failure} failed`);
      },
    }), new RegExp(`${failure} failed`));
    assert.deepEqual(calls, failure === "migrate" ? ["migrate"] : ["migrate", "router"]);
  }
});

test("speedtest failure is reported without publishing the router again", async () => {
  const calls = [];
  await assert.rejects(() => deployAll({
    log() {},
    async run(args) {
      calls.push(args[0]);
      if (args.includes("--config")) throw new Error("speedtest failed");
    },
  }), /speedtest failed/);
  assert.deepEqual(calls, ["d1", "deploy", "deploy"]);
});

test("combined dry runs check both Workers and never migrate or publish", async () => {
  const calls = [];
  await deployAll({
    dryRun: true,
    log() {},
    async run(args, secret) {
      calls.push(args);
      assert.equal(args[0], "deploy");
      assert.ok(args.includes("--dry-run"));
      if (args.includes("--config")) {
        assert.deepEqual(args, ["deploy", "--config", speedtestConfig, "--dry-run"]);
        assert.equal(secret, undefined);
      } else {
        assert.ok(args.includes("--secrets-file"));
      }
    },
  });
  assert.equal(calls.length, 2);
});

test("speedtest can be deployed alone without migration or route Secret generation", async () => {
  const calls = [];
  await deploySpeedtest({
    log() {},
    async run(args, secret) {
      calls.push(args);
      assert.equal(secret, undefined);
    },
  });
  assert.deepEqual(calls, [["deploy", "--config", speedtestConfig]]);
});

test("the CLI rejects unknown or conflicting flags before deployment", () => {
  const script = fileURLToPath(new URL("../scripts/deploy.js", import.meta.url));
  for (const flags of [["--dryrun"], ["--router-only", "--speedtest-only"], ["--development", "--router-only"], ["--development", "--speedtest-only"]]) {
    const result = spawnSync(process.execPath, [script, ...flags], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Usage: node scripts\/deploy\.js/);
    assert.equal(result.stdout, "");
  }
});
