import assert from "node:assert/strict";
import test from "node:test";
import { ASSETS } from "../src/generated/assets.js";
import { magicRuleUrl, nativeMagicRuleSource } from "../src/magic-rules.js";

test("MagicRule registry covers template placeholders with official full artifacts", () => {
  const names = [...new Set([...ASSETS.template.matchAll(/{{RULESET_([A-Za-z0-9]+)}}/g)].map((match) => match[1]))];
  assert.deepEqual([...names].sort(), Object.keys(ASSETS.magicRules).sort());
  assert.equal(names.length, 24);
  assert.doesNotMatch(ASSETS.template, /blackmatrix7|ios_rule_script/);
  for (const name of names) {
    for (const [client, key, extension] of [["surge", "rules", "list"], ["mihomo", "classical", "yaml"]]) {
      assert.match(magicRuleUrl(name, client), new RegExp(`^https://(?:magicrule|rule-26r)\\.pages\\.dev/data/_shared/artifacts/${name}_${key}_[0-9a-f]{16}\\.${extension}$`));
    }
  }
  assert.match(magicRuleUrl("OKX", "surge"), /^https:\/\/rule-26r\.pages\.dev\//);
  for (const [name, client] of [["Google", "surge"], ["Bing", "surge"], ["Copilot", "surge"], ["WeChat", "surge"], ["__proto__", "surge"], ["OpenAI", "other"], ["OpenAI", "toString"]]) {
    assert.throws(() => magicRuleUrl(name, client));
  }
});

test("only a registered Surge artifact referenced as RULE-SET maps to the rule's Mihomo artifact", () => {
  const surge = magicRuleUrl("OpenAI", "surge");
  assert.deepEqual(nativeMagicRuleSource({ kind: "RULE-SET", url: surge }), { name: "OpenAI", url: magicRuleUrl("OpenAI", "mihomo"), format: "yaml" });
  for (const source of [
    { kind: "DOMAIN-SET", url: surge },
    { kind: "RULE-SET", url: `${surge}?token=private` },
    { kind: "RULE-SET", url: magicRuleUrl("OpenAI", "mihomo") },
    { kind: "RULE-SET", url: surge.replace("magicrule.pages.dev", "example.com") },
    { kind: "RULE-SET", url: surge.replace("magicrule.pages.dev", "rule-26r.pages.dev") },
  ]) assert.equal(nativeMagicRuleSource(source), null);
});
