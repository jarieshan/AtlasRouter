#!/usr/bin/env node

import { ASSETS } from "../src/generated/assets.js";
import { downloadMagicRuleSet, findMagicRuleSource, magicRuleLines } from "../src/magic-rules.js";

const CLIENTS = [["surge", "Surge", "list"], ["mihomo", "Mihomo", "yaml"]];
const index = {};
for (const [, clientName] of CLIENTS) {
  const response = await fetch(`https://magicrule.pages.dev/data/index/${clientName}.json`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok || !/json/.test(response.headers.get("content-type") ?? "")) throw new Error(`MagicRule ${clientName} index: HTTP ${response.status}`);
  index[clientName] = (await response.json()).rules;
}

let checked = 0;
let failures = 0;
for (const name of Object.keys(ASSETS.magicRules)) {
  for (const [client, clientName, extension] of CLIENTS) {
    checked += 1;
    const source = findMagicRuleSource(`magicrule/${client}/${name}.${extension}`);
    const problems = [];
    let rules = 0;
    if (!source) problems.push("not registered for a template placeholder");
    else {
      const listed = index[clientName].filter((rule) => rule.name === name).map((rule) => rule.manifest);
      if (!listed.includes(source.manifest)) problems.push(`the index lists ${listed.join(", ") || "no manifest"}`);
      try { rules = magicRuleLines(await downloadMagicRuleSet(source), client).length; } catch { problems.push(`${source.manifest} gives no valid list`); }
    }
    if (problems.length) failures += 1;
    console.log(problems.length ? `FAIL ${client} ${name}: ${problems.join("; ")}` : `ok   ${client} ${name}: ${rules} rules`);
  }
}
if (failures) {
  console.log(`${failures} of ${checked} MagicRule lists need attention; update surge/magicrule.json from the MagicRule index.`);
  process.exitCode = 1;
}
