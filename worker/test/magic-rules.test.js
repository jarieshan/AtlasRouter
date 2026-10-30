import assert from "node:assert/strict";
import test from "node:test";
import { ASSETS } from "../src/generated/assets.js";
import { downloadMagicRuleSet, findMagicRuleSource, magicRuleUrl } from "../src/magic-rules.js";

const source = findMagicRuleSource("magicrule/surge/Copilot.list");
const artifactUrl = "https://magicrule.pages.dev/data/_shared/artifacts/Copilot_rules_test.list";
const manifest = (url = artifactUrl) => ({ client: "Surge", rule: "Copilot", artifacts: [{ role: "full", ext: "list", url }] });

test("MagicRule registry covers configured placeholders and excludes arbitrary paths", () => {
  const names = [...ASSETS.template.matchAll(/{{RULESET_([A-Za-z0-9]+)}}/g)].map((match) => match[1]);
  assert.deepEqual(names, Object.keys(ASSETS.magicRules));
  assert.equal(names.length, 22);
  assert.doesNotMatch(ASSETS.template.replace(/^RULE-SET,https:\/\/cdn\.jsdelivr\.net\/gh\/blackmatrix7\/ios_rule_script@master\/rule\/Surge\/WeChat\/WeChat\.list,.*$/m, ""), /blackmatrix7|ios_rule_script/);
  for (const name of names) {
    for (const [client, extension] of [["surge", "list"], ["mihomo", "yaml"]]) {
      const registered = findMagicRuleSource(`magicrule/${client}/${name}.${extension}`);
      assert.equal(registered.name, name);
      assert.match(registered.manifest, /^https:\/\/magicrule\.pages\.dev\/data\/rules\/(Surge|Mihomo)\/[a-f0-9]{24}\/manifest\.json$/);
      const url = new URL(magicRuleUrl(name, client, "https://atlas.example/AtlasRouter?other=private#fragment", "test-token"));
      assert.equal(url.origin, "https://atlas.example");
      assert.equal(url.search, "?token=test-token");
      assert.equal(url.hash, "");
    }
  }
  for (const path of ["magicrule/surge/WeChat.list", "magicrule/mihomo/WeChat.yaml", "magicrule/surge/Unknown.list", "magicrule/mihomo/Copilot.list", "magicrule/surge/Copilot.yaml", "magicrule/surge/__proto__.list", "magicrule/surge/../Copilot.list", "https://example.com/Copilot.list"]) {
    assert.equal(findMagicRuleSource(path), null);
  }
});

test("MagicRule downloads follow the current full artifact in a manifest, retaining native client formats", async () => {
  for (const [client, extension, body] of [
    ["surge", "list", "# test\nDOMAIN-SUFFIX,example.com\nIP-CIDR,192.0.2.0/24,no-resolve\n"],
    ["mihomo", "yaml", "payload:\n  - DOMAIN-SUFFIX,example.com\n  - IP-CIDR,192.0.2.0/24,no-resolve\n"],
  ]) {
    const registered = findMagicRuleSource(`magicrule/${client}/Copilot.${extension}`);
    for (const revision of ["first", "updated"]) {
      const url = `https://magicrule.pages.dev/data/_shared/artifacts/Copilot_rules_${revision}.${extension}`;
      const calls = [];
      const result = await downloadMagicRuleSet(registered, async (target, options) => {
        calls.push(target);
        assert.equal(options.redirect, "manual");
        assert.equal(options.cf.cacheTtl, 3600);
        assert.deepEqual(Object.keys(options.headers).sort(), ["accept", "user-agent"]);
        if (target === registered.manifest) return Response.json({ client: client === "surge" ? "Surge" : "Mihomo", rule: "Copilot", artifacts: [
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
});

test("MagicRule rejects wrong identities, foreign artifacts, incomplete lists and invalid responses", async () => {
  const invalid = [
    { ...manifest(), client: "Mihomo" }, { ...manifest(), rule: "Other" },
    { ...manifest(), artifacts: [] },
    { ...manifest(), artifacts: [{ ...manifest().artifacts[0], empty: true }] },
    { ...manifest(), artifacts: [{ ...manifest().artifacts[0], binary: true }] },
    { ...manifest(), artifacts: [{ ...manifest().artifacts[0], role: "domain-set" }] },
    ...["https://internal.local/x.list", "https://magicrule.pages.dev.evil.example/test.list", "https://user:pass@magicrule.pages.dev/data/_shared/artifacts/Copilot_test.list", "https://magicrule.pages.dev/data/_shared/artifacts/Other_rules_test.list", `${artifactUrl}?token=private`, `${artifactUrl}#fragment`].map(manifest),
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
  for (const body of ["", "# empty", "<html>PRIVATE_DETAIL</html>", "[Rule]\nFINAL,DIRECT", "x".repeat(4 * 1024 * 1024 + 1)]) {
    await assert.rejects(downloadMagicRuleSet(source, async (url) => url === source.manifest ? Response.json(manifest()) : new Response(body)), (error) => error.status === 502);
  }
  const mihomo = findMagicRuleSource("magicrule/mihomo/Copilot.yaml");
  for (const body of ["payload: []", "payload: [null]", "payload: [{type: invalid}]", "payload: [\"bad rule\"]", "payload: [", "proxies: []"]) {
    await assert.rejects(downloadMagicRuleSet(mihomo, async (url) => url === mihomo.manifest
      ? Response.json({ client: "Mihomo", rule: "Copilot", artifacts: [{ role: "full", ext: "yaml", url: artifactUrl.replace(".list", ".yaml") }] })
      : new Response(body)), (error) => error.status === 502);
  }
});
