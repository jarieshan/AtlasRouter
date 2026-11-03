import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSETS } from "../src/generated/assets.js";
import { convertClashRuleSet } from "../src/clash-rules.js";

test("repository rule sets referenced by the template exist on this branch and convert for Clash", () => {
  const references = ASSETS.template.match(/https:\/\/cdn\.jsdelivr\.net\/gh\/jarieshan\/AtlasRouter@[^/\s]+\/[^\s,]+/g);
  const paths = [...new Set(references.map((url) => {
    const match = /^https:\/\/cdn\.jsdelivr\.net\/gh\/jarieshan\/AtlasRouter@develop\/(surge\/rule-sets\/[A-Za-z]+\.list)$/.exec(url);
    assert.ok(match, url);
    return match[1];
  }))];
  assert.deepEqual(paths, ["surge/rule-sets/WeChat.list"]);
  for (const path of paths) {
    const text = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
    const rules = text.split("\n").filter((line) => line && !line.startsWith("#"));
    assert.ok(rules.length > 0, path);
    const userAgents = rules.filter((line) => line.startsWith("USER-AGENT,")).length;
    assert.equal(convertClashRuleSet(text).split("\n")[0], `# AtlasRouter: ${userAgents} unsupported rule entries omitted`, path);
  }
});
