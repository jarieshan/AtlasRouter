import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { buildBranches } from "../scripts/build-branches.js";

test("one Worker executes different Git branch implementations and keeps D1 data separate", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "atlas-branch-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = path.join(directory, "repo");
  await mkdir(path.join(repo, "worker/src"), { recursive: true });
  await mkdir(path.join(repo, "worker/migrations"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master");
  git("config", "user.name", "Branch Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(path.join(repo, "worker/package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(path.join(repo, "worker/branch-runtime.json"), '{"version":1,"entry":"src/index.js","storage":"d1-pool","query":"dev"}\n');
  await writeFile(path.join(repo, "worker/migrations/0001.sql"), "CREATE TABLE data (value TEXT);\n");
  await writeFile(path.join(repo, "worker/src/index.js"), `import { convert } from "./convert.js";
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/AtlasRouter") return new Response("missing", { status: 404 });
  if (url.searchParams.get("token") !== env.API_TOKEN) return new Response("denied", { status: 401 });
  if (request.method !== "GET") return new Response("method", { status: 405 });
  const row = await env.DB.prepare("SELECT value FROM data").first();
  return new Response(convert(row.value), { headers: { "cache-control": "no-store" } });
} };\n`);
  await writeFile(path.join(repo, "worker/src/convert.js"), 'export const convert = value => "master-converter:" + value.toUpperCase();\n');
  git("add", ".");
  git("commit", "-m", "Stable converter");
  const master = git("rev-parse", "HEAD");
  git("switch", "-c", "develop");
  await writeFile(path.join(repo, "worker/src/convert.js"), 'export const convert = value => JSON.stringify({ converter: "develop-v1", value });\n');
  git("add", ".");
  git("commit", "-m", "Different converter implementation");
  const output = path.join(directory, "bundle");
  const options = { repoRoot: repo, output, fetchRemote: false, install: false, verify: false, log() {} };
  const first = await buildBranches(options);
  assert.equal(first.refs.master, master);
  assert.notEqual(first.refs.master, first.refs.develop);
  assert.deepEqual(first.contracts, { master: true, develop: true });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "one-worker", modules: true,
    script: await readFile(path.join(output, "index.js"), "utf8"), compatibilityDate: "2026-05-12",
    d1Databases: { DB: "prod-db", DEV_DB: "dev-db" },
    bindings: { API_TOKEN: "prod-test", DEV_API_TOKEN: "dev-test" },
  }));
  t.after(() => mf.dispose());
  for (const [binding, value] of [["DB", "production"], ["DEV_DB", "development"]]) {
    const db = await mf.getD1Database(binding);
    await db.prepare("CREATE TABLE data (value TEXT)").run();
    await db.prepare("INSERT INTO data VALUES (?)").bind(value).run();
  }
  const get = (query, pathname = "/AtlasRouter") => mf.dispatchFetch(`https://atlas.example${pathname}${query}`);
  assert.equal(await (await get("?token=prod-test")).text(), "master-converter:PRODUCTION");
  assert.deepEqual(await (await get("?token=dev-test&dev=1")).json(), { converter: "develop-v1", value: "development" });
  for (const query of ["", "?token=prod-test&dev=1", "?token=dev-test"]) assert.equal((await get(query)).status, 401);
  assert.equal((await get("?dev=1", "/missing")).status, 404);
  assert.equal((await get("?dev=1&dev=0")).status, 400);

  await writeFile(path.join(repo, "worker/src/convert.js"), 'export const convert = value => "develop-v2:" + value;\n');
  git("add", ".");
  git("commit", "-m", "Update only development converter");
  const second = await buildBranches(options);
  assert.equal(second.refs.master, first.refs.master);
  assert.notEqual(second.refs.develop, first.refs.develop);
  await mf.setOptions(convertV4MiniflareOptions({ name: "one-worker", modules: true,
    script: await readFile(path.join(output, "index.js"), "utf8"), compatibilityDate: "2026-05-12",
    d1Databases: { DB: "prod-db", DEV_DB: "dev-db" }, bindings: { API_TOKEN: "prod-test", DEV_API_TOKEN: "dev-test" },
  }));
  assert.equal(await (await get("?token=prod-test")).text(), "master-converter:PRODUCTION");
  assert.equal(await (await get("?token=dev-test&dev=1")).text(), "develop-v2:development");

  const goodArtifact = await readFile(path.join(output, "index.js"), "utf8");
  await writeFile(path.join(repo, "worker/src/convert.js"), 'invalid JavaScript !!!\n');
  git("add", ".");
  git("commit", "-m", "Broken development build");
  await assert.rejects(() => buildBranches(options));
  assert.equal(await readFile(path.join(output, "index.js"), "utf8"), goodArtifact);
});
