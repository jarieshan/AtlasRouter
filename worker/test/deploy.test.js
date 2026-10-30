import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { deploy } from "../scripts/deploy.js";

test("GitHub only verifies changes without deployment jobs or credentials", async () => {
  const workflow = parseYaml(await readFile(new URL("../../.github/workflows/worker.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on.push.branches, ["develop", "master"]);
  assert.deepEqual(Object.keys(workflow.jobs), ["verify"]);
  assert.equal(workflow.jobs.verify.environment, undefined);
  assert.ok(!JSON.stringify(workflow).includes("secrets."));
  assert.deepEqual(workflow.jobs.verify.steps.flatMap((step) => step.run ? [step.run] : []),
    ["npm ci", "npm test"]);
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

test("the deployment helper refuses direct CLI execution", () => {
  const script = fileURLToPath(new URL("../scripts/deploy.js", import.meta.url));
  for (const args of [[], ["--branch", "master"], ["--branch", "develop"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Use npm run deploy in Cloudflare Workers Builds for master/);
    assert.equal(result.stdout, "");
  }
});
