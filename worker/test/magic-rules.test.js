import assert from "node:assert/strict";
import test from "node:test";
import { ASSETS } from "../src/generated/assets.js";
import { downloadMagicRuleSet, findMagicRuleSource, magicRuleUrl, nativeMagicRuleSource, serveMagicRuleSet } from "../src/magic-rules.js";
import { createD1Env } from "../test-helpers/d1.js";

const REQUEST_URL = "https://atlas.example/AtlasRouter?token=private&other=x#fragment";
const source = findMagicRuleSource("magicrule/surge/OpenAI.list");
const artifactUrl = "https://magicrule.pages.dev/data/_shared/artifacts/OpenAI_rules_test.list";
const manifest = (url = artifactUrl) => ({ client: "Surge", rule: "OpenAI", artifacts: [{ role: "full", ext: "list", url }] });
const LIST = "# OpenAI\nDOMAIN-SUFFIX,openai.com\nIP-CIDR,192.0.2.0/24,no-resolve\n";
const upstream = (body = LIST, url = artifactUrl) => async (target) => target === source.manifest ? Response.json(manifest(url)) : new Response(body);
const relayRequest = (etag) => new Request(magicRuleUrl("OpenAI", "surge", REQUEST_URL), etag ? { headers: { "if-none-match": etag } } : {});

test("MagicRule registry covers template placeholders with manifests on either MagicRule site and token-free relay URLs", () => {
  const names = [...new Set([...ASSETS.template.matchAll(/{{RULESET_([A-Za-z0-9]+)}}/g)].map((match) => match[1]))];
  assert.deepEqual([...names].sort(), Object.keys(ASSETS.magicRules).sort());
  assert.equal(names.length, 38);
  assert.doesNotMatch(ASSETS.template, /blackmatrix7|ios_rule_script/);
  const rules = ASSETS.template.split("\n").filter((line) => line.startsWith("RULE-SET,{{RULESET_"));
  assert.equal(rules.length, 38);
  for (const line of rules) assert.match(line, /^RULE-SET,{{RULESET_[A-Za-z0-9]+}},[^,]+,no-resolve,update-interval=21600$/);
  for (const name of names) {
    for (const [client, clientName, extension] of [["surge", "Surge", "list"], ["mihomo", "Mihomo", "yaml"]]) {
      const registered = findMagicRuleSource(`magicrule/${client}/${name}.${extension}`);
      assert.equal(registered.name, name);
      assert.match(registered.manifest, new RegExp(`^https://(?:magicrule|rule-26r)\\.pages\\.dev/data/rules/${clientName}/[a-f0-9]{24}/manifest\\.json$`));
      assert.equal(magicRuleUrl(name, client, REQUEST_URL), `https://atlas.example/AtlasRouter/rules/magicrule/${client}/${name}.${extension}`);
    }
  }
  for (const name of ["OKX", "IBKR", "LongBridge"]) assert.match(findMagicRuleSource(`magicrule/surge/${name}.list`).manifest, /^https:\/\/rule-26r\.pages\.dev\//);
  assert.equal(magicRuleUrl("OpenAI", "surge", "https://atlas.example/AtlasRouter?dev=1&token=private"), "https://atlas.example/AtlasRouter-Dev/rules/magicrule/surge/OpenAI.list");
  for (const path of ["magicrule/surge/GlobalMedia.list", "magicrule/mihomo/GlobalMedia.yaml", "magicrule/surge/WeChat.list", "magicrule/surge/Copilot.list", "magicrule/mihomo/OpenAI.list", "magicrule/surge/OpenAI.yaml", "magicrule/surge/__proto__.list", "magicrule/surge/toString.list", "magicrule/other/OpenAI.list", "magicrule/surge/../OpenAI.list", "magicrule/surge/OpenAI.list/x", "https://example.com/OpenAI.list"]) {
    assert.equal(findMagicRuleSource(path), null, path);
  }
  for (const [name, client] of [["GlobalMedia", "surge"], ["GlobalMedia", "mihomo"], ["Google", "surge"], ["Bing", "surge"], ["Copilot", "surge"], ["WeChat", "surge"], ["__proto__", "surge"], ["OpenAI", "other"], ["OpenAI", "toString"]]) {
    assert.throws(() => magicRuleUrl(name, client, REQUEST_URL));
  }
});

test("only the relay's Surge URL for a registered rule maps to the rule's Mihomo relay", () => {
  const surge = magicRuleUrl("OpenAI", "surge", REQUEST_URL);
  assert.deepEqual(nativeMagicRuleSource({ kind: "RULE-SET", url: surge }, REQUEST_URL), { name: "OpenAI", url: magicRuleUrl("OpenAI", "mihomo", REQUEST_URL), format: "yaml" });
  const legacy = "https://atlas.example/AtlasRouter?dev=1&token=private";
  assert.equal(nativeMagicRuleSource({ kind: "RULE-SET", url: magicRuleUrl("OpenAI", "surge", legacy) }, legacy).url, magicRuleUrl("OpenAI", "mihomo", legacy));
  for (const url of [
    `${surge}?token=private`, `${surge}#fragment`, `${surge}?dev=1`, `${surge}?dev=2`,
    magicRuleUrl("OpenAI", "mihomo", REQUEST_URL),
    surge.replace("atlas.example", "example.com"),
    surge.replace("/AtlasRouter/", "/AtlasRouter-Dev/"),
    surge.replace("OpenAI", "Copilot"),
    "https://magicrule.pages.dev/data/_shared/artifacts/OpenAI_rules_0123456789abcdef.list",
  ]) assert.equal(nativeMagicRuleSource({ kind: "RULE-SET", url }, REQUEST_URL), null, url);
  assert.equal(nativeMagicRuleSource({ kind: "DOMAIN-SET", url: surge }, REQUEST_URL), null);
});

test("MagicRule downloads follow the current full artifact on the manifest's own site, retaining native client formats", async () => {
  for (const [name, origin] of [["OpenAI", "https://magicrule.pages.dev"], ["OKX", "https://rule-26r.pages.dev"]]) {
    for (const [client, extension, body] of [
      ["surge", "list", "# test\nDOMAIN-SUFFIX,example.com\nIP-CIDR,192.0.2.0/24,no-resolve\n"],
      ["mihomo", "yaml", "payload:\n  - 'DOMAIN-SUFFIX,example.com'\n  - \"DOMAIN,api.example.com\"\n  - IP-CIDR,192.0.2.0/24,no-resolve\n"],
    ]) {
      const registered = findMagicRuleSource(`magicrule/${client}/${name}.${extension}`);
      assert.equal(new URL(registered.manifest).origin, origin);
      for (const revision of ["first", "updated"]) {
        const url = `${origin}/data/_shared/artifacts/${name}_rules_${revision}.${extension}`;
        const calls = [];
        const result = await downloadMagicRuleSet(registered, async (target, options) => {
          calls.push(target);
          assert.equal(options.redirect, "manual");
          assert.equal(options.cf.cacheTtl, 3600);
          assert.deepEqual(Object.keys(options.headers).sort(), ["accept", "user-agent"]);
          if (target === registered.manifest) return Response.json({ client: client === "surge" ? "Surge" : "Mihomo", rule: name, artifacts: [
            { role: "domain-set", ext: extension, url: "https://invalid.example/partial" },
            { role: "full", ext: extension, url },
          ] });
          assert.equal(target, url);
          return new Response(body);
        });
        assert.equal(result, body);
        assert.deepEqual(calls, [registered.manifest, url]);
      }
    }
  }
});

test("MagicRule rejects wrong identities, foreign artifacts, incomplete lists and invalid responses", async () => {
  const invalid = [
    { ...manifest(), client: "Mihomo" }, { ...manifest(), rule: "Other" },
    { ...manifest(), artifacts: [] },
    { ...manifest(), artifacts: [{ ...manifest().artifacts[0], empty: true }] },
    { ...manifest(), artifacts: [{ ...manifest().artifacts[0], binary: true }] },
    { ...manifest(), artifacts: [{ ...manifest().artifacts[0], role: "domain-set" }] },
    { ...manifest(), artifacts: [{ ...manifest().artifacts[0], ext: "yaml" }] },
    ...["https://internal.local/x.list", "https://magicrule.pages.dev.evil.example/test.list", "https://user:pass@magicrule.pages.dev/data/_shared/artifacts/OpenAI_test.list",
      "https://magicrule.pages.dev/data/_shared/artifacts/Other_rules_test.list", "https://magicrule.pages.dev/data/_shared/artifacts/OpenAI_rules_test.yaml",
      "https://magicrule.pages.dev/data/rules/OpenAI_rules_test.list", "https://rule-26r.pages.dev/data/_shared/artifacts/OpenAI_rules_test.list",
      `${artifactUrl}?token=private`, `${artifactUrl}#fragment`].map(manifest),
  ];
  for (const data of invalid) {
    let calls = 0;
    await assert.rejects(downloadMagicRuleSet(source, async () => {
      calls += 1;
      assert.equal(calls, 1, "invalid manifests must not trigger an artifact request");
      return Response.json(data);
    }), (error) => error.status === 502);
  }
  const responses = [
    () => new Response(null, { status: 302, headers: { location: "https://internal.local" } }),
    () => new Response("PRIVATE_DETAIL", { status: 500 }),
    () => new Response("x".repeat(256 * 1024 + 1)),
    () => new Response("<html>PRIVATE_DETAIL</html>"),
    () => { throw new Error("PRIVATE_DETAIL"); },
  ];
  for (const response of responses) await assert.rejects(downloadMagicRuleSet(source, response), (error) => error.status === 502 && !error.message.includes("PRIVATE_DETAIL"));
  for (const body of ["", "# empty", "<!doctype html><html>PRIVATE_DETAIL</html>", "[Rule]\nFINAL,DIRECT", "payload:\n  - DOMAIN,example.com\n", "x".repeat(4 * 1024 * 1024 + 1)]) {
    await assert.rejects(downloadMagicRuleSet(source, upstream(body)), (error) => error.status === 502);
  }
  const mihomo = findMagicRuleSource("magicrule/mihomo/OpenAI.yaml");
  for (const body of ["payload: []", "payload:\n", "payload: [null]", "payload:\n  - 'bad rule'\n", "payload:\n  - 'DOMAIN,example.com\"\n", "payload: [",
    "proxies: []", "payload:\n  - DOMAIN,example.com\nproxies: []\n", "DOMAIN,example.com\n", "<!doctype html><html></html>"]) {
    await assert.rejects(downloadMagicRuleSet(mihomo, async (url) => url === mihomo.manifest
      ? Response.json({ client: "Mihomo", rule: "OpenAI", artifacts: [{ role: "full", ext: "yaml", url: artifactUrl.replace(".list", ".yaml") }] })
      : new Response(body)), (error) => error.status === 502, body);
  }
});

test("MagicRule relay answers with ETags and serves the last valid copy while the upstream is unusable", async () => {
  const env = createD1Env();
  const first = await serveMagicRuleSet(relayRequest(), env, source, upstream());
  assert.equal(first.status, 200);
  assert.equal(await first.text(), LIST);
  assert.equal(first.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(first.headers.get("cache-control"), "no-cache");
  const etag = first.headers.get("etag");
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  assert.equal(env.writeCount, 1);
  assert.equal((await serveMagicRuleSet(relayRequest(), env, source, upstream())).headers.get("etag"), etag);
  assert.equal(env.writeCount, 1, "unchanged lists are not rewritten");
  for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
    const cached = await serveMagicRuleSet(relayRequest(header), env, source, upstream());
    assert.equal(cached.status, 304, header);
    assert.equal(cached.body, null);
    assert.equal(cached.headers.get("etag"), etag);
  }
  assert.equal((await serveMagicRuleSet(relayRequest('"other"'), env, source, upstream())).status, 200);
  for (const failure of [
    async () => new Response("<html>PRIVATE_DETAIL</html>"),
    async () => new Response(null, { status: 503 }),
    async () => { throw new Error("PRIVATE_DETAIL"); },
    upstream("<!doctype html><html></html>"),
    upstream(LIST, "https://rule-26r.pages.dev/data/_shared/artifacts/OpenAI_rules_test.list"),
  ]) {
    const stored = await serveMagicRuleSet(relayRequest(), env, source, failure);
    assert.equal(stored.status, 200);
    assert.equal(await stored.text(), LIST);
    assert.equal(stored.headers.get("etag"), etag);
    assert.equal((await serveMagicRuleSet(relayRequest(etag), env, source, failure)).status, 304);
  }
  assert.equal(env.writeCount, 1);
  const updated = `${LIST}DOMAIN-SUFFIX,chatgpt.com\n`;
  const next = await serveMagicRuleSet(relayRequest(etag), env, source, upstream(updated, artifactUrl.replace("_test", "_updated")));
  assert.equal(next.status, 200);
  assert.equal(await next.text(), updated);
  assert.notEqual(next.headers.get("etag"), etag);
  assert.equal(env.writeCount, 2);
  assert.equal(await (await serveMagicRuleSet(relayRequest(), env, source, upstream(""))).text(), updated);
  const mihomo = findMagicRuleSource("magicrule/mihomo/OpenAI.yaml");
  const yaml = "payload:\n  - 'DOMAIN-SUFFIX,openai.com'\n";
  const response = await serveMagicRuleSet(new Request(magicRuleUrl("OpenAI", "mihomo", REQUEST_URL)), env, mihomo, async (target) => target === mihomo.manifest
    ? Response.json({ client: "Mihomo", rule: "OpenAI", artifacts: [{ role: "full", ext: "yaml", url: "https://magicrule.pages.dev/data/_shared/artifacts/OpenAI_classical_test.yaml" }] })
    : new Response(yaml));
  assert.equal(response.headers.get("content-type"), "application/yaml; charset=utf-8");
  assert.equal(await response.text(), yaml);
});

test("MagicRule relay fails closed without a stored copy for that client and tolerates storage failures", async () => {
  const env = createD1Env();
  await assert.rejects(serveMagicRuleSet(relayRequest(), env, source, async () => new Response("<html>PRIVATE_DETAIL</html>")),
    (error) => error.status === 502 && !error.message.includes("PRIVATE_DETAIL"));
  await serveMagicRuleSet(relayRequest(), env, source, upstream());
  const mihomo = findMagicRuleSource("magicrule/mihomo/OpenAI.yaml");
  await assert.rejects(serveMagicRuleSet(new Request(magicRuleUrl("OpenAI", "mihomo", REQUEST_URL)), env, mihomo, async () => new Response(null, { status: 500 })),
    (error) => error.status === 502);
  const broken = { DB: { prepare() { throw new Error("PRIVATE_DETAIL"); } } };
  const fresh = await serveMagicRuleSet(relayRequest(), broken, source, upstream());
  assert.equal(fresh.status, 200);
  assert.equal(await fresh.text(), LIST);
  await assert.rejects(serveMagicRuleSet(relayRequest(), broken, source, async () => new Response(null, { status: 500 })),
    (error) => error.status === 502 && !error.message.includes("PRIVATE_DETAIL"));
});
