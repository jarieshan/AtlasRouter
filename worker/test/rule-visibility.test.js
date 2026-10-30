import assert from "node:assert/strict";
import test from "node:test";
import { applyRuleSetVisibility } from "../src/rule-visibility.js";
import { convertSurgeToClash } from "../src/render-clash.js";

function profile(rules, hidden = "false") {
  return `[Proxy]\nnode = trojan, example.com, 443, password="TEST_ONLY,hidden=true"\n[Proxy Group]\nGroup = select, node, DIRECT, hidden=${hidden}\nOther = select, Group, hidden=true\n[Rule]\n${rules}\nFINAL,Group\n`;
}

test("rule-set hidden annotations hide the target group in both formats without dropping rules", async () => {
  const source = profile("RULE-SET,https://example.com/rules.list,Group,no-resolve,hidden=true,update-interval=60\nDOMAIN-SET,https://example.com/domains.list,Group");
  const normalized = applyRuleSetVisibility(source);
  assert.match(normalized, /^Group = select, node, DIRECT, hidden=true$/m);
  assert.match(normalized, /^Other = select, Group, hidden=true$/m);
  assert.match(normalized, /^RULE-SET,https:\/\/example.com\/rules.list,Group,no-resolve,update-interval=60$/m);
  assert.match(normalized, /^DOMAIN-SET,https:\/\/example.com\/domains.list,Group$/m);
  assert.equal(normalized.split("[Proxy Group]")[0], source.split("[Proxy Group]")[0]);
  assert.equal(applyRuleSetVisibility(normalized), normalized);
  const { config } = await convertSurgeToClash(source, { requestUrl: "https://atlas.example/AtlasRouter", token: "TEST_ONLY" });
  assert.equal(config["proxy-groups"].find(({ name }) => name === "Group").hidden, true);
  assert.deepEqual(config["proxy-groups"].find(({ name }) => name === "Group").proxies, ["node", "DIRECT"]);
  assert.equal(config.rules.length, 3);
  assert.match(config.rules[0], /^RULE-SET,[^,]+,Group,no-resolve$/);
  assert.match(config.rules[1], /^RULE-SET,[^,]+,Group$/);
  assert.equal(config.rules[2], "MATCH,Group");
  assert.equal(Object.values(config["rule-providers"])[0].interval, 60);
});

test("explicit false restores group visibility without a default flag and respects quoted rule fields", () => {
  const source = profile('DOMAIN-SET,"https://example.com/domains?a=1,b=2",Group, hidden = false', "true");
  const normalized = applyRuleSetVisibility(source);
  assert.match(normalized, /^Group = select, node, DIRECT$/m);
  assert.match(normalized, /^Other = select, Group, hidden=true$/m);
  assert.ok(normalized.includes('DOMAIN-SET,"https://example.com/domains?a=1,b=2",Group\n'));
  assert.equal(applyRuleSetVisibility(normalized), normalized);
});

test("ambiguous, invalid or untargetable visibility annotations are rejected", () => {
  for (const rules of [
    "RULE-SET,https://example.com/rules.list,Group,hidden=true,hidden=false",
    "RULE-SET,https://example.com/rules.list,Group,hidden=true\nRULE-SET,https://example.com/more.list,Group,hidden=false",
    "RULE-SET,https://example.com/rules.list,Group,hidden=invalid",
    "RULE-SET,https://example.com/rules.list,DIRECT,hidden=true",
    "RULE-SET,https://example.com/rules.list,Missing,hidden=true",
  ]) assert.throws(() => applyRuleSetVisibility(profile(rules)));
  const source = profile("# RULE-SET,https://example.com/rules.list,Group,hidden=true\nDOMAIN,example.com,Group");
  assert.equal(applyRuleSetVisibility(source), source);
});
