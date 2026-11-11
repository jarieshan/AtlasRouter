import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CHECK_INTERVAL, NOTIFY_AFTER, checkMagicRules } from "../src/magic-rule-check.js";
import { magicRuleSources } from "../src/magic-rules.js";
import { createD1Env } from "../test-helpers/d1.js";

const KEY = "test-device-key";
const sources = magicRuleSources();
const id = (source) => `${source.client}/${source.name}`;
const artifact = (source) => `${new URL(source.manifest).origin}/data/_shared/artifacts/${source.name}_test.${source.extension}`;
const slot = (name, client, round = 0) =>
  (sources.findIndex((source) => source.name === name && source.client === client) + round * sources.length) * CHECK_INTERVAL;

function upstream() {
  const state = { broken: new Set(), lists: [], pushes: [], bark: () => Response.json({ code: 200, message: "success" }) };
  state.fetcher = async (url, init = {}) => {
    if (url === "https://api.day.app/push") {
      state.pushes.push({ init, body: JSON.parse(init.body) });
      return state.bark();
    }
    const manifest = sources.find((source) => source.manifest === url);
    if (manifest) {
      state.lists.push(id(manifest));
      if (state.broken.has(id(manifest))) return new Response("<!doctype html><html></html>", { headers: { "content-type": "text/html" } });
      return Response.json({ client: manifest.client === "surge" ? "Surge" : "Mihomo", rule: manifest.name,
        artifacts: [{ role: "full", ext: manifest.extension, url: artifact(manifest) }] });
    }
    const list = sources.find((source) => artifact(source) === url);
    if (!list) return new Response(null, { status: 404 });
    const rule = `DOMAIN-SUFFIX,${list.name.toLowerCase()}.example`;
    return new Response(list.client === "surge" ? `${rule}\n` : `payload:\n  - '${rule}'\n`);
  };
  return state;
}

test("the cron checks one registered list per run, covers all of them in one rotation and keeps each copy", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, ["*/5 * * * *"]);
  assert.equal(CHECK_INTERVAL, 5 * 60 * 1000);
  const env = createD1Env();
  env.BARK_DEVICE_KEY = KEY;
  await env.DB.prepare(`INSERT INTO magic_rule_checks (name, client, failures, notified, updated_at) VALUES
    ('Removed', 'surge', 5, 0, '2026-01-01T00:00:00.000Z'), ('Retired', 'mihomo', 0, 1, '2026-01-01T00:00:00.000Z')`).run();
  const state = upstream();
  assert.equal(sources.length, 70);
  for (let run = 0; run < sources.length; run += 1) await checkMagicRules(env, run * CHECK_INTERVAL, state.fetcher);
  assert.deepEqual(state.lists, sources.map(id));
  assert.equal(new Set(state.lists).size, sources.length);
  assert.equal((await env.DB.prepare("SELECT count(*) AS count FROM magic_rule_sets").first()).count, sources.length);
  assert.equal((await env.DB.prepare("SELECT count(*) AS count FROM magic_rule_checks").first()).count, 2);
  assert.deepEqual(state.pushes, [], "healthy and unregistered lists are not reported");
  await checkMagicRules(env, sources.length * CHECK_INTERVAL, state.fetcher);
  assert.equal(state.lists.at(-1), id(sources[0]));
});

test("Bark reports a list after two failed checks in a row, once, and again when it recovers", async () => {
  const env = createD1Env();
  env.BARK_DEVICE_KEY = KEY;
  const state = upstream();
  state.broken.add("mihomo/OpenAI");
  await checkMagicRules(env, slot("OpenAI", "mihomo"), state.fetcher);
  await checkMagicRules(env, slot("OpenAI", "mihomo") + CHECK_INTERVAL, state.fetcher);
  assert.equal(state.pushes.length, 0);
  await checkMagicRules(env, slot("OpenAI", "mihomo", 1), state.fetcher);
  assert.equal(state.pushes.length, 1);
  const [{ init, body }] = state.pushes;
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "content-type": "application/json; charset=utf-8" });
  assert.deepEqual(Object.keys(body).sort(), ["body", "device_key", "group", "title"]);
  assert.equal(body.device_key, KEY);
  assert.equal(body.group, "AtlasRouter");
  assert.equal(body.title, "AtlasRouter：MagicRule 规则检查失败");
  assert.match(body.body, new RegExp(`^OpenAI（Mihomo）连续 ${NOTIFY_AFTER} 次检查失败。`));
  for (const time of [slot("OpenAI", "mihomo", 1) + CHECK_INTERVAL, slot("OpenAI", "mihomo", 2)]) await checkMagicRules(env, time, state.fetcher);
  assert.equal(state.pushes.length, 1, "a failing list is reported once");
  state.broken.clear();
  await checkMagicRules(env, slot("OpenAI", "mihomo", 3), state.fetcher);
  assert.equal(state.pushes.length, 2);
  assert.equal(state.pushes[1].body.title, "AtlasRouter：MagicRule 规则已恢复");
  assert.equal(state.pushes[1].body.body, "OpenAI（Mihomo）已恢复。");
  await checkMagicRules(env, slot("OpenAI", "mihomo", 4), state.fetcher);
  state.broken.add("surge/OpenAI");
  await checkMagicRules(env, slot("OpenAI", "surge", 5), state.fetcher);
  state.broken.clear();
  await checkMagicRules(env, slot("OpenAI", "surge", 6), state.fetcher);
  assert.equal(state.pushes.length, 2, "recovered lists and single failures are not reported");
  const { results } = await env.DB.prepare("SELECT name, client, failures, notified FROM magic_rule_checks ORDER BY client").all();
  assert.deepEqual(results.map((row) => ({ ...row })), [
    { name: "OpenAI", client: "mihomo", failures: 0, notified: 0 },
    { name: "OpenAI", client: "surge", failures: 0, notified: 0 },
  ]);
});

test("failed Bark pushes are retried on later runs, and a missing key only logs list names", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const env = createD1Env();
  const state = upstream();
  state.broken.add("surge/China");
  for (let round = 0; round < NOTIFY_AFTER; round += 1) await checkMagicRules(env, slot("China", "surge", round), state.fetcher);
  assert.equal(state.pushes.length, 0);
  assert.match(warn.mock.calls.at(-1).arguments[0], /BARK_DEVICE_KEY is not set\. Failing: China（Surge）\./);
  env.BARK_DEVICE_KEY = KEY;
  state.bark = () => new Response(`{"code":400,"message":"failed to get [${KEY}] device token"}`, { status: 400 });
  await checkMagicRules(env, slot("China", "surge") + CHECK_INTERVAL, state.fetcher);
  assert.equal(warn.mock.calls.at(-1).arguments[0], "MagicRule check: Bark returned HTTP 400.");
  state.bark = () => { throw new Error(KEY); };
  await checkMagicRules(env, slot("China", "surge") + 2 * CHECK_INTERVAL, state.fetcher);
  assert.equal(warn.mock.calls.at(-1).arguments[0], "MagicRule check: the Bark request failed.");
  await checkMagicRules(env, slot("China", "surge", NOTIFY_AFTER), state.fetcher);
  state.bark = () => Response.json({ code: 200, message: "success" });
  for (let run = 3; run <= 4; run += 1) await checkMagicRules(env, slot("China", "surge") + run * CHECK_INTERVAL, state.fetcher);
  assert.equal(state.pushes.length, 4, "pushes stop once Bark accepts one");
  assert.match(state.pushes[0].body.body, /^China（Surge）连续 2 次检查失败。/);
  assert.match(state.pushes.at(-1).body.body, /^China（Surge）连续 3 次检查失败。/);
  assert.ok(warn.mock.calls.every((call) => !String(call.arguments[0]).includes(KEY)));
  const stored = await env.DB.prepare("SELECT failures, notified FROM magic_rule_checks WHERE name = 'China' AND client = 'surge'").first();
  assert.deepEqual({ ...stored }, { failures: NOTIFY_AFTER + 1, notified: 1 });
});
