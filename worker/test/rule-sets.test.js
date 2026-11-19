import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSETS } from "../src/generated/assets.js";
import { convertClashRuleSet, findClashRuleSource, ruleSource } from "../src/clash-rules.js";
import { repositoryTemplate } from "../src/repository-rules.js";

test("repository files referenced by the template exist on this branch and rule sets convert for Clash", () => {
  assert.match(ASSETS.template, /AtlasRouter@\{\{REPOSITORY_RULES_REF\}\}/);
  assert.doesNotMatch(ASSETS.template, /AtlasRouter@(?:master|develop)\//);
  const references = repositoryTemplate().match(/https:\/\/cdn\.jsdelivr\.net\/gh\/jarieshan\/AtlasRouter@[^/\s]+\/[^\s,]+/g);
  const paths = [...new Set(references.map((url) => {
    const match = /^https:\/\/cdn\.jsdelivr\.net\/gh\/jarieshan\/AtlasRouter@master\/(surge\/rule-sets\/[A-Za-z]+\.list|scripts\/[a-z-]+\.js)$/.exec(url);
    assert.ok(match, url);
    return match[1];
  }))];
  assert.deepEqual(paths.sort(), ["surge/rule-sets/Coin.list", "surge/rule-sets/CustomAI.list", "surge/rule-sets/CustomDirect.list", "surge/rule-sets/CustomReject.list", "surge/rule-sets/RedPocket.list", "surge/rule-sets/WeChat.list"]);
  for (const path of paths) {
    const text = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    if (!path.endsWith(".list")) continue;
    const rules = text.split("\n").filter((line) => line && !line.startsWith("#"));
    assert.ok(rules.length > 0, path);
    const userAgents = rules.filter((line) => line.startsWith("USER-AGENT,")).length;
    assert.equal(convertClashRuleSet(text).split("\n")[0], `# AtlasRouter: ${userAgents} unsupported rule entries omitted`, path);
  }
});

test("deployment rule references render the same template and keep source registries separate", async () => {
  const production = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const development = JSON.parse(readFileSync(new URL("../wrangler.development.jsonc", import.meta.url), "utf8"));
  assert.equal(production.vars.REPOSITORY_RULES_REF, "master");
  assert.equal(development.vars.REPOSITORY_RULES_REF, "develop");
  const references = [production.vars.REPOSITORY_RULES_REF, development.vars.REPOSITORY_RULES_REF];
  const templates = references.map((ref) => repositoryTemplate(ref));
  assert.equal(templates[0].replaceAll("AtlasRouter@master/", "AtlasRouter@develop/"), templates[1]);
  for (const ref of references) {
    const url = `https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@${ref}/surge/rule-sets/WeChat.list`;
    const source = await ruleSource(["RULE-SET", url]);
    for (const selected of references) {
      assert.deepEqual(await findClashRuleSource(`${source.id}.txt`, selected), selected === ref ? source : null);
    }
  }
});

test("invalid deployment rule references fail without interpolating their values", async () => {
  for (const ref of ["", "main", "master/path", "develop\nINJECTED", null]) {
    assert.throws(() => repositoryTemplate(ref), { status: 503, message: "Repository rule reference is not configured correctly" });
    await assert.rejects(findClashRuleSource(`rule-${"0".repeat(32)}.txt`, ref), { status: 503 });
  }
});
