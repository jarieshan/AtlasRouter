import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";
import { convertClashNode } from "../src/clash-nodes.js";
import { convertClashRules, convertClashRuleSet, downloadClashRuleSet, findClashRuleSource, ruleSource } from "../src/clash-rules.js";
import { convertSurgeToClash, renderClashProfile } from "../src/render-clash.js";
import { renderSurgeProfile } from "../src/render-surge.js";
import { allocateNodes, parsePoolNodes, userGroups } from "../src/node-pool.js";
import { buildSubscriptionUrl, readSubscriptionOptions } from "../src/subscription-options.js";
import { magicRuleUrl } from "../src/magic-rules.js";
import { orderedSmartPriority, splitSurgeList, surgeAssignment, surgeOptions } from "../src/surge-format.js";

const context = { requestUrl: "https://atlas.example/AtlasRouter", token: `ar_${"a".repeat(64)}` };
const wechatUrl = "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/WeChat.list";
const customDirectUrl = "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/CustomDirect.list";
const customRejectUrl = "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/CustomReject.list";
const directUrl = "https://magicrule.pages.dev/data/_shared/artifacts/China_rules_25adbc0394103807.list";
const iconBase = "https://cdn.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/";
const uuid = "11111111-2222-4333-8444-555555555555";
const vmess = `vmess, vmess.example.com, 443, username=${uuid}, vmess-aead=true, tls=true`;

function profile() {
  const state = { nodes: parsePoolNodes([
    { id: "hk", line: "🇭🇰 HK IDC = trojan, hk.example.com, 443, password=TEST_ONLY" },
    { id: "us2", line: `🇺🇸 US ISP 2 = ${vmess}` },
    { id: "us1", line: `🇺🇸 US ISP 1 = ${vmess}` },
    { id: "warp", line: "🇺🇸 US WARP = ss, warp.example.com, 443, encrypt-method=aes-128-gcm, password=TEST_ONLY" },
  ]), users: [{ id: "other", enabled: true }, { id: "user", enabled: true }] };
  allocateNodes(state, "2026-01-01T00:00:00Z");
  const groups = userGroups(state, "user");
  return { ...context, groups, nodes: groups.flatMap((group) => group.nodes) };
}

test("subscription options default to Surge, validate duplicates, and preserve only supported options in managed URLs", () => {
  assert.deepEqual(readSubscriptionOptions(new URLSearchParams()), { client: "surge", doh: false, tencentOa: false });
  assert.deepEqual(readSubscriptionOptions(new URLSearchParams("client=clash&doh=1")), { client: "clash", doh: true, tencentOa: false });
  for (const query of ["client=", "client=other", "client=clash&client=surge", "doh=true", "doh=", "doh=1&doh=0"]) {
    assert.throws(() => readSubscriptionOptions(new URLSearchParams(query)), (error) => error.status === 400);
  }
  const input = profile();
  const plain = renderSurgeProfile(input);
  const encrypted = renderSurgeProfile({ ...input, requestUrl: `${context.requestUrl}?unknown=secret#fragment`, options: { doh: true } });
  assert.doesNotMatch(plain, /^encrypted-dns-(?:server|follow-outbound-mode) =/m);
  assert.deepEqual(plain.match(/^hijack-dns\s*=.*$/gm), ["hijack-dns = 8.8.8.8:53, 8.8.4.4:53"]);
  assert.match(encrypted, /^encrypted-dns-server = https:\/\/cloudflare-dns\.com\/dns-query, https:\/\/dns\.google\/dns-query$/m);
  assert.match(encrypted, /^encrypted-dns-follow-outbound-mode = true$/m);
  for (const url of [customDirectUrl, directUrl]) {
    assert.ok(plain.split("\n").includes(`RULE-SET:${url} = server:223.5.5.5, 119.29.29.29`));
    assert.ok(encrypted.split("\n").includes(`RULE-SET:${url} = server:https://dns.alidns.com/dns-query, https://doh.pub/dns-query`));
  }
  assert.doesNotMatch(plain, /jsdelivr\.net\/gh\/Loyalsoldier\/surge-rules/);
  for (const config of [plain, encrypted]) {
    assert.ok(config.split("\n").includes(`Auto = smart, include-all-proxies=true, icon-url=${iconBase}Auto.png`));
    assert.match(config, /^Proxy = select, 🇺🇸USA-ISP, 🇺🇸USA-WARP, 🇭🇰HK-IDC, Auto, DIRECT, /m);
    assert.match(config, /\[Host\]\nzslab\.ai = server:223\.5\.5\.5, 119\.29\.29\.29\n\*\.zslab\.ai = server:223\.5\.5\.5, 119\.29\.29\.29\n/);
    assert.ok(config.split("\n").includes(`DoH Proxy = smart, 🇭🇰 HK IDC, icon-url=${iconBase}Server.png, hidden=true`));
    assert.doesNotMatch(config, /^PROTOCOL,DOH,/m);
    const hosts = config.split("[Host]\n")[1].split("[Proxy]\n")[0];
    for (const hostname of ["dns.alidns.com", "doh.pub"]) {
      const mapping = `${hostname} = server:223.5.5.5, 119.29.29.29`;
      assert.ok(hosts.split("\n").includes(mapping));
      assert.ok(hosts.indexOf(mapping) < hosts.indexOf(`RULE-SET:${directUrl}`));
    }
    for (const hostname of ["atlasrouter.zslab.ai", "develop.atlasrouter.zslab.ai"]) {
      const directRule = `DOMAIN,${hostname},DIRECT`;
      assert.ok(config.indexOf(directRule) >= 0);
      assert.ok(config.indexOf(directRule) < config.indexOf("DOMAIN,dns.alidns.com,DIRECT"));
    }
    for (const [hostname, policy] of [["cloudflare-dns.com", "DoH Proxy"], ["dns.google", "DoH Proxy"], ["dns.alidns.com", "DIRECT"], ["doh.pub", "DIRECT"]]) {
      const rule = `DOMAIN,${hostname},${policy}`;
      assert.ok(config.includes(rule));
      assert.ok(config.indexOf(rule) < config.indexOf("RULE-SET,https://"));
      assert.ok(config.indexOf(rule) < config.indexOf("GEOIP,CN,DIRECT"));
    }
    const rules = config.split("[Rule]\n")[1].split("[MITM]")[0].split("\n").filter((line) => line && !line.startsWith("#"));
    assert.deepEqual(rules.slice(-4), [`RULE-SET,${directUrl},DIRECT,no-resolve`, "RULE-SET,LAN,DIRECT", "GEOIP,CN,DIRECT", "FINAL,Proxy,dns-failed"]);
  }
  assert.deepEqual(encrypted.match(/^hijack-dns\s*=.*$/gm), ["hijack-dns = 8.8.8.8:53, 8.8.4.4:53"]);
  assert.equal(encrypted.match(/^#!MANAGED-CONFIG (\S+)/)[1], `${context.requestUrl}?token=${context.token}&doh=1`);
  assert.doesNotMatch(encrypted, /unknown=|#fragment/);
  assert.equal(buildSubscriptionUrl(context.requestUrl, context.token, { client: "clash", doh: true }), `${context.requestUrl}?token=${context.token}&client=clash&doh=1`);
});

test("Clash output is derived from the rendered Surge profile and retains sorting, allocation and rules", async () => {
  const input = profile();
  const wechatSource = await ruleSource(["RULE-SET", wechatUrl]);
  const customDirectSource = await ruleSource(["RULE-SET", customDirectUrl]);
  const customRejectSource = await ruleSource(["RULE-SET", customRejectUrl]);
  const directSource = await ruleSource(["RULE-SET", directUrl]);
  for (const source of [wechatSource, customDirectSource, customRejectSource]) {
    assert.deepEqual(await findClashRuleSource(`${source.id}.txt`), source);
  }
  assert.equal(await findClashRuleSource(`${directSource.id}.txt`), null);
  for (const doh of [false, true]) {
    const surge = renderSurgeProfile({ ...input, options: { doh } });
    const output = await renderClashProfile(surge, context);
    const config = parse(output);
    assert.equal(config["x-clash-block-quic"], "all-proxy");
    for (const hostname of ["atlasrouter.zslab.ai", "develop.atlasrouter.zslab.ai"]) {
      const index = config.rules.indexOf(`DOMAIN,${hostname},DIRECT`);
      assert.ok(index >= 0);
      assert.ok(index < config.rules.findIndex((rule) => rule.startsWith("RULE-SET,")));
    }
    assert.deepEqual(config.proxies.map((node) => node.name), ["🇺🇸 US ISP 1", "🇺🇸 US ISP 2", "🇺🇸 US WARP", "🇭🇰 HK IDC"]);
    for (const group of input.groups) {
      assert.equal(config["proxy-groups"].find(({ name }) => name === group.group).type, "fallback");
      assert.equal(config["proxy-groups"].find(({ name }) => name === group.group).interval, 300);
      assert.deepEqual(config["proxy-groups"].find(({ name }) => name === group.group).proxies, group.nodes.map(({ name }) => name));
      assert.equal(config["proxy-groups"].find(({ name }) => name === group.group).hidden, undefined);
      assert.equal(config["proxy-groups"].find(({ name }) => name === group.group).icon, undefined);
    }
    const icons = { "Proxy": "Proxy", "AIProxy": "AI", "iCloud": "iCloud", "AppleDirect": "Apple", "WeChat": "WeChat", "Telegram": "Telegram", "X": "X", "YouTube": "YouTube", "GlobalMedia": "Media" };
    assert.deepEqual(config["proxy-groups"].filter((group) => group.type === "select").map((group) => group.name), Object.keys(icons));
    for (const [name, file] of Object.entries(icons)) assert.equal(config["proxy-groups"].find((group) => group.name === name)?.icon, `${iconBase}${file}.png`);
    for (const name of ["Proxy", "AIProxy", "X"]) {
      assert.deepEqual(config["proxy-groups"].find((group) => group.name === name).proxies, ["🇺🇸USA-ISP", "🇺🇸USA-WARP", "🇭🇰HK-IDC", name === "Proxy" ? "Auto" : "Proxy", "DIRECT"]);
    }
    assert.deepEqual(config["proxy-groups"].find((group) => group.name === "GlobalMedia").proxies, ["🇺🇸USA-WARP", "🇭🇰HK-IDC", "🇺🇸USA-ISP", "Proxy", "DIRECT"]);
    assert.ok(!config["proxy-groups"].some((group) => group.name === "AppleProxy"));
    const appleDirect = config["proxy-groups"].find((group) => group.name === "AppleDirect");
    assert.deepEqual(appleDirect.proxies, ["DIRECT"]);
    assert.equal(appleDirect.hidden, true);
    const icloud = config["proxy-groups"].find((group) => group.name === "iCloud");
    assert.deepEqual(icloud.proxies, ["DIRECT", "🇭🇰HK-IDC", "🇺🇸USA-WARP", "🇺🇸USA-ISP"]);
    assert.ok(!icloud.hidden);
    const wechat = config["proxy-groups"].find((group) => group.name === "WeChat");
    assert.deepEqual(wechat.proxies, ["DIRECT", "🇭🇰HK-IDC", "🇺🇸USA-WARP", "🇺🇸USA-ISP"]);
    assert.ok(!wechat.hidden);
    assert.ok(config.rules.includes(`RULE-SET,${wechatSource.id},WeChat,no-resolve`));
    const telegram = config["proxy-groups"].find((group) => group.name === "Telegram");
    assert.deepEqual(telegram.proxies, ["🇭🇰HK-IDC", "🇺🇸USA-WARP", "🇺🇸USA-ISP", "Proxy", "DIRECT"]);
    assert.ok(!telegram.hidden);
    const youtube = config["proxy-groups"].find((group) => group.name === "YouTube");
    assert.deepEqual(youtube.proxies, ["🇺🇸USA-WARP", "🇭🇰HK-IDC", "🇺🇸USA-ISP"]);
    assert.ok(!youtube.hidden);
    const youtubeRule = "RULE-SET,YouTube,YouTube,no-resolve";
    assert.ok(config.rules.includes(youtubeRule));
    assert.ok(config.rules.indexOf(youtubeRule) < config.rules.indexOf("RULE-SET,GlobalMedia,GlobalMedia,no-resolve"));
    for (const group of config["proxy-groups"].filter((group) => group.type === "select")) assert.ok(!group.proxies.includes("REJECT"), group.name);
    assert.deepEqual(config["proxy-groups"].filter((group) => [icloud, appleDirect].includes(group)).map((group) => group.name), ["iCloud", "AppleDirect"]);
    assert.equal(config.rules.at(-1), "MATCH,Proxy");
    const resolvedLan = config.rules.indexOf("IP-CIDR,192.168.0.0/16,DIRECT");
    const directRule = config.rules.indexOf("RULE-SET,China,DIRECT,no-resolve");
    assert.ok(directRule >= 0 && directRule < resolvedLan);
    assert.ok(resolvedLan < config.rules.indexOf("GEOIP,CN,DIRECT"));
    assert.ok(config.rules.includes(`RULE-SET,${customRejectSource.id},REJECT,no-resolve`));
    assert.equal(config["proxy-groups"][0].timeout, 5000);
    assert.deepEqual(config.dns.nameserver, doh ? ["https://cloudflare-dns.com/dns-query#RULES", "https://dns.google/dns-query#RULES"] : ["223.5.5.5", "119.29.29.29", "system"]);
    // Node bootstrap must not depend on the proxy used by encrypted DNS.
    assert.deepEqual(config.dns["proxy-server-nameserver"], ["223.5.5.5", "119.29.29.29", "system"]);
    assert.deepEqual(config.dns["nameserver-policy"], {
      "zslab.ai": ["223.5.5.5", "119.29.29.29"], ".zslab.ai": ["223.5.5.5", "119.29.29.29"],
      "dns.alidns.com": ["223.5.5.5", "119.29.29.29"], "doh.pub": ["223.5.5.5", "119.29.29.29"],
      ...Object.fromEntries([customDirectSource.id, "China"].map((provider) => [`rule-set:${provider}`, doh
        ? ["https://dns.alidns.com/dns-query#RULES", "https://doh.pub/dns-query#RULES"]
        : ["223.5.5.5", "119.29.29.29"]])),
    });
    const auto = config["proxy-groups"].find((group) => group.name === "Auto");
    assert.equal(auto.type, "url-test");
    assert.equal(auto.icon, `${iconBase}Auto.png`);
    assert.deepEqual(auto.proxies, config.proxies.map(({ name }) => name));
    assert.equal(auto.interval, 300);
    assert.equal(auto.tolerance, 0);
    assert.ok(!auto.hidden);
    const dohProxy = config["proxy-groups"].find((group) => group.name === "DoH Proxy");
    assert.equal(dohProxy.type, "url-test");
    assert.equal(dohProxy.icon, `${iconBase}Server.png`);
    assert.equal(dohProxy.hidden, true);
    assert.deepEqual(dohProxy.proxies, ["🇭🇰 HK IDC"]);
    assert.equal(dohProxy.interval, 300);
    assert.equal(dohProxy.tolerance, 0);
    for (const hostname of ["cloudflare-dns.com", "dns.google"]) assert.ok(config.rules.includes(`DOMAIN,${hostname},DoH Proxy`));
    for (const hostname of ["dns.alidns.com", "doh.pub"]) assert.ok(config.rules.includes(`DOMAIN,${hostname},DIRECT`));
    assert.ok(config.rules.every((rule) => !rule.startsWith("PROTOCOL,")));
    assert.match(output, /smart approximated by url-test/);
    assert.match(output, /ordered smart converted to fallback/);
    assert.doesNotMatch(output, /Host entry|Section host|encrypted-dns-follow-outbound-mode: unsupported/);
    assert.deepEqual(config.tun?.["dns-hijack"], ["8.8.8.8:53", "8.8.4.4:53"]);
    if (doh) assert.deepEqual(config.dns["default-nameserver"], ["223.5.5.5", "119.29.29.29"]);
    assert.ok(config.rules.includes(`RULE-SET,${customDirectSource.id},DIRECT,no-resolve`));
    assert.deepEqual(Object.keys(config["rule-providers"]), [customRejectSource.id, customDirectSource.id, wechatSource.id, "Binance", "AppleTV", "AppleIntelligence", "iCloud", "AppleDirect", "Apple", "Direct", "OpenAI", "Bing", "Copilot", "Anthropic", "Gemini", "Telegram", "Twitter", "Discord", "YouTube", "Cloudflare", "Netflix", "Disney", "Hulu", "IMDB", "GlobalMedia", "China"]);
    assert.ok(config.rules.includes("RULE-SET,Copilot,AIProxy,no-resolve"));
    assert.deepEqual(config.rules.filter((rule) => /^RULE-SET,(?:AppleTV|AppleIntelligence|iCloud|AppleDirect|Apple|Direct),/.test(rule)), [
      "RULE-SET,AppleTV,GlobalMedia,no-resolve",
      "RULE-SET,AppleIntelligence,AIProxy,no-resolve",
      "RULE-SET,iCloud,iCloud,no-resolve",
      "RULE-SET,AppleDirect,AppleDirect,no-resolve",
      "RULE-SET,Apple,AppleDirect,no-resolve",
      "RULE-SET,Direct,DIRECT,no-resolve",
    ]);
    const repository = new Map([customRejectSource, customDirectSource, wechatSource].map((source) => [source.id, source.url]));
    for (const [name, provider] of Object.entries(config["rule-providers"])) {
      assert.equal(provider.url, repository.get(name) ?? magicRuleUrl(name, "mihomo"));
      assert.ok(!provider.url.includes(context.token));
      assert.equal(provider.behavior, "classical");
      assert.equal(provider.format, repository.has(name) ? "text" : "yaml");
      assert.equal(provider.interval, 86400);
    }
    assert.match(output, /General skip-proxy: unsupported setting omitted/);
    assert.doesNotMatch(output, /#!MANAGED-CONFIG|\.sgmodule|{{|💎 Select/);
  }
});

test("hidden DoH Proxy contains only enabled IDC nodes across regions for each user", async () => {
  const state = { nodes: parsePoolNodes([
    { id: "hk1", line: `🇭🇰 HK IDC 1 = ${vmess}` },
    { id: "hk2", line: `🇭🇰 HK IDC 2 = ${vmess}` },
    { id: "us", line: `🇺🇸 US IDC = ${vmess}` },
    { id: "isp", line: `🇺🇸 US ISP = ${vmess}` },
    { id: "warp", line: `🇺🇸 US WARP = ${vmess}` },
    { id: "disabled", line: `🇸🇬 SG IDC = ${vmess}`, enabled: false },
  ]), users: [{ id: "alice", enabled: true }, { id: "bob", enabled: true }] };
  allocateNodes(state, "2026-01-01T00:00:00Z");
  for (const [index, user] of state.users.entries()) for (const doh of [false, true]) {
    const groups = userGroups(state, user.id);
    const source = renderSurgeProfile({ ...context, groups, nodes: groups.flatMap((group) => group.nodes), options: { doh }, smartPriorityScheme: "geometric-10" });
    const members = ["🇺🇸 US IDC", ...["🇭🇰 HK IDC 1", "🇭🇰 HK IDC 2"].slice(index), ...["🇭🇰 HK IDC 1", "🇭🇰 HK IDC 2"].slice(0, index)];
    const line = source.split("\n").find((line) => line.startsWith("DoH Proxy = "));
    assert.deepEqual(splitSurgeList(surgeAssignment(line)[1]), ["smart", ...members, `icon-url=${iconBase}Server.png`, "hidden=true"]);
    const { config } = await convertSurgeToClash(source, context);
    const group = config["proxy-groups"].find(({ name }) => name === "DoH Proxy");
    assert.equal(group.type, "url-test");
    assert.equal(group.hidden, true);
    assert.deepEqual(group.proxies, members);
  }
});

test("subscriptions without IDC nodes reject foreign DoH while retaining domestic DNS and other policies", async () => {
  const input = profile();
  const groups = input.groups.filter((group) => group.nodes[0].ipType !== "IDC");
  for (const doh of [false, true]) {
    const source = renderSurgeProfile({ ...input, groups, nodes: groups.flatMap((group) => group.nodes), options: { doh } });
    assert.doesNotMatch(source, /^DoH Proxy =/m);
    assert.doesNotMatch(source, /^PROTOCOL,DOH,/m);
    assert.match(source, /^FINAL,Proxy,dns-failed$/m);
    const { config } = await convertSurgeToClash(source, context);
    assert.ok(!config["proxy-groups"].some(({ name }) => name === "DoH Proxy"));
    assert.equal(config.rules.at(-1), "MATCH,Proxy");
    for (const [hostname, policy] of [["cloudflare-dns.com", "REJECT"], ["dns.google", "REJECT"], ["dns.alidns.com", "DIRECT"], ["doh.pub", "DIRECT"]]) {
      const rule = `DOMAIN,${hostname},${policy}`;
      assert.ok(source.split("\n").includes(rule));
      assert.ok(config.rules.includes(rule));
      assert.ok(config.rules.indexOf(rule) < config.rules.findIndex((line) => line.startsWith("RULE-SET,")));
    }
  }
});

test("Clash rejects foreign DoH if all IDC nodes are unsupported and retains any compatible IDC member", async () => {
  const input = profile();
  const source = renderSurgeProfile({ ...input, options: { doh: true } });
  for (const keepCompatible of [false, true]) {
    const changed = source.replace("🇭🇰 HK IDC = trojan, hk.example.com, 443, password=TEST_ONLY", "🇭🇰 HK IDC = trojan, hk.example.com, 443, password=TEST_ONLY, unsupported-option=NEVER_LOG_THIS")
      .replace("[Proxy]\n", `[Proxy]\n${keepCompatible ? `🇯🇵 JP IDC = ${vmess}\n` : ""}`)
      .replace("DoH Proxy = smart, 🇭🇰 HK IDC,", `DoH Proxy = smart, 🇭🇰 HK IDC,${keepCompatible ? " 🇯🇵 JP IDC," : ""}`);
    const { config, warnings } = await convertSurgeToClash(changed, context);
    const group = config["proxy-groups"].find(({ name }) => name === "DoH Proxy");
    if (keepCompatible) {
      assert.equal(group.type, "url-test");
      assert.equal(group.hidden, true);
      assert.deepEqual(group.proxies, ["🇯🇵 JP IDC"]);
    } else {
      assert.equal(group, undefined);
      assert.ok(warnings.some((warning) => warning.includes("no compatible DoH proxy; using REJECT")));
    }
    for (const hostname of ["cloudflare-dns.com", "dns.google"]) assert.ok(config.rules.includes(`DOMAIN,${hostname},${keepCompatible ? "DoH Proxy" : "REJECT"}`));
    for (const hostname of ["dns.alidns.com", "doh.pub"]) assert.ok(config.rules.includes(`DOMAIN,${hostname},DIRECT`));
    assert.equal(config.rules.at(-1), "MATCH,Proxy");
    assert.doesNotMatch(warnings.join("\n"), /NEVER_LOG_THIS/);
  }
});

test("native production and Preview profiles differ only in addresses, tokens, visibility and Surge priority factors", async () => {
  // Compare the current source under both deployments, not the historical master branch.
  const deployment = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const environments = [
    { vars: deployment.vars, origin: "https://atlas.example", token: `ar_${"a".repeat(64)}` },
    { vars: deployment.previews.vars, origin: "https://develop.atlas.example", token: `ar_${"b".repeat(64)}` },
  ];
  assert.equal(environments[0].vars.SMART_PRIORITY_SCHEME ?? "linear", "linear");
  assert.equal(environments[1].vars.SMART_PRIORITY_SCHEME, "geometric-10");
  assert.equal(environments[0].vars.SHOW_ALL_PROXY_GROUPS, undefined);
  assert.equal(environments[1].vars.SHOW_ALL_PROXY_GROUPS, "true");
  const input = profile();
  for (const doh of [false, true]) for (const tencentOa of [false, true]) {
    const rendered = [];
    for (const { vars, origin, token } of environments) {
      const requestUrl = `${origin}${vars.SUBSCRIPTION_PATH}`;
      const options = { doh, tencentOa };
      const showAllGroups = vars.SHOW_ALL_PROXY_GROUPS === "true";
      const source = renderSurgeProfile({ ...input, requestUrl, token, options, smartPriorityScheme: vars.SMART_PRIORITY_SCHEME, showAllGroups });
      const normalizeAddress = (text) => text.replaceAll(requestUrl, "https://profile.example/SUBSCRIPTION").replaceAll(token, "TEST_TOKEN");
      assert.equal(source.match(/^#!MANAGED-CONFIG (\S+)/)[1], buildSubscriptionUrl(requestUrl, token, options));
      assert.match(source, /^block-quic = per-policy$/m);
      assert.match(source, /^FINAL,Proxy,dns-failed$/m);
      const groupSection = source.split("[Proxy Group]\n")[1].split("[Rule]\n")[0];
      assert.equal(/hidden\s*=/i.test(groupSection), !showAllGroups);
      const result = { surge: normalizeAddress(source).replace(/policy-priority="(?:\\.|[^"\\])*"/g, 'policy-priority="CHECKED_SEPARATELY"').replace(/, hidden=true$/gm, "") };
      if (!tencentOa) {
        const { config, warnings } = await convertSurgeToClash(source, { requestUrl, token });
        assert.equal(config["x-clash-block-quic"], "all-proxy");
        assert.equal(config.rules.at(-1), "MATCH,Proxy");
        assert.ok(config.proxies.filter(({ type }) => ["vmess", "trojan"].includes(type)).every(({ udp }) => udp === true));
        assert.equal(config["proxy-groups"].some((group) => group.hidden === true), !showAllGroups);
        for (const group of config["proxy-groups"]) delete group.hidden;
        result.clash = normalizeAddress(JSON.stringify(config));
        result.warnings = warnings;
      }
      rendered.push(result);
    }
    assert.deepEqual(rendered[0], rendered[1], `environment drift for doh=${doh}, tencentOa=${tencentOa}`);
  }
});

test("Host UDP DNS mappings preserve suffix depth and omit unsupported values without leaking them", async () => {
  const source = `[Host]\nexample.com = server:223.5.5.5, 119.29.29.29\n*.example.com = server:9.9.9.9\nexample.com = server:8.8.8.8\ninvalid.example = server:999.1.1.1\nsecret.example = script:NEVER_LOG_THIS\n[Proxy]\nnode = trojan, example.com, 443, password=TEST_ONLY\n[Rule]\nFINAL,node\n`;
  const { config, warnings } = await convertSurgeToClash(source, context);
  assert.deepEqual({ ...config.dns["nameserver-policy"] }, { "example.com": ["223.5.5.5", "119.29.29.29"], ".example.com": ["9.9.9.9"] });
  assert.equal(warnings.length, 2);
  assert.doesNotMatch(warnings.join("\n"), /secret\.example|NEVER_LOG_THIS|999\.1\.1\.1/);
});

test("Host DoH mappings follow the outbound setting and only reuse declared domain-set providers", async () => {
  const source = `[Host]\nDOMAIN-SET:${directUrl} = server:https://dns.alidns.com/dns-query, https://doh.pub/dns-query\nDOMAIN-SET:${directUrl} = server:8.8.8.8\nDOMAIN-SET:https://rules.example.com/unregistered.txt = server:223.5.5.5\nprivate.example = server:https://user:NEVER_LOG_THIS@dns.example.com/dns-query\nunsafe.example = server:https://dns.example.com/dns-query#skip-cert-verify\nhttp.example = server:http://dns.example.com/dns-query\n[Proxy]\nnode = ${vmess}\n[Rule]\nDOMAIN-SET,${directUrl},DIRECT\nFINAL,node\n`;
  const directSource = await ruleSource(["DOMAIN-SET", directUrl]);
  for (const follow of [false, true]) {
    const { config, warnings } = await convertSurgeToClash(`[General]\nencrypted-dns-follow-outbound-mode = ${follow}\n${source}`, context);
    const suffix = follow ? "#RULES" : "";
    assert.deepEqual({ ...config.dns["nameserver-policy"] }, {
      [`rule-set:${directSource.id}`]: [`https://dns.alidns.com/dns-query${suffix}`, `https://doh.pub/dns-query${suffix}`],
    });
    assert.deepEqual(Object.keys(config["rule-providers"]), [directSource.id]);
    assert.equal(warnings.length, 4);
    assert.doesNotMatch(warnings.join("\n"), /NEVER_LOG_THIS|private\.example|unregistered|skip-cert-verify/);
  }
  const { config, warnings } = await convertSurgeToClash(source.replace(`DOMAIN-SET,${directUrl},DIRECT\n`, ""), context);
  assert.equal(config.dns["nameserver-policy"], undefined);
  assert.deepEqual(Object.keys(config["rule-providers"]), []);
  assert.equal(warnings.length, 6);
  const genericUrl = "https://rules.example.com/direct.list";
  const ruleSet = await ruleSource(["RULE-SET", genericUrl]);
  const mapped = await convertSurgeToClash(`[Host]\nRULE-SET:${genericUrl} = server:223.5.5.5\nRULE-SET:${directUrl} = server:119.29.29.29\n[Proxy]\nnode = ${vmess}\n[Rule]\nRULE-SET,${genericUrl},DIRECT,no-resolve\nRULE-SET,${directUrl},DIRECT,no-resolve\nFINAL,node\n`, context);
  assert.deepEqual({ ...mapped.config.dns["nameserver-policy"] }, { [`rule-set:${ruleSet.id}`]: ["223.5.5.5"], "rule-set:China": ["119.29.29.29"] });
  assert.deepEqual(mapped.warnings, []);
});

test("smart conversion includes only proxy nodes and retains automatic selection references", async () => {
  const source = `[General]\nproxy-test-url = http://www.gstatic.com/generate_204\n[Proxy]\nnode = trojan, example.com, 443, password=TEST_ONLY\n[Proxy Group]\nbackup = fallback, node\nauto = smart, backup, DIRECT, REJECT, include-all-proxies=true\nProxy = select, auto, backup\n[Rule]\nDOMAIN,dns.google,auto\nFINAL,Proxy\n`;
  const { config, warnings } = await convertSurgeToClash(source, context);
  const auto = config["proxy-groups"].find(({ name }) => name === "auto");
  assert.deepEqual(auto, { name: "auto", type: "url-test", proxies: ["node"], url: "http://www.gstatic.com/generate_204", interval: 300, timeout: 5000, tolerance: 0 });
  assert.deepEqual(config.rules, ["DOMAIN,dns.google,auto", "MATCH,Proxy"]);
  assert.ok(warnings.some((warning) => warning.includes("smart approximated")));
});

test("ordered smart weights match exact node names and each user's primary while Clash retains fallback order", async () => {
  const names = ["🇺🇸 US ISP a.b", "🇺🇸 US ISP axb", '🇺🇸 US ISP (a+b)?|^$ "quote":x;y\\z'];
  const state = { nodes: parsePoolNodes(names.map((name, index) => ({ id: `node-${index}`, line: `${name} = ${vmess}` }))),
    users: names.map((_, index) => ({ id: `user-${index}`, enabled: true })) };
  allocateNodes(state, "2026-01-01T00:00:00Z");
  const schemes = { linear: [1, 2, 3], "geometric-3": [1, 3, 9], "geometric-10": [1, 10, 100] };
  for (const [smartPriorityScheme, expectedWeights] of Object.entries(schemes)) for (const user of state.users) {
    const groups = userGroups(state, user.id);
    const source = renderSurgeProfile({ ...context, groups, nodes: groups.flatMap((group) => group.nodes), smartPriorityScheme });
    const line = source.split("\n").find((line) => line.startsWith("🇺🇸USA-ISP = smart, "));
    const parts = splitSurgeList(surgeAssignment(line)[1]).slice(1);
    const options = surgeOptions(parts.filter((part) => part.includes("=")));
    const members = parts.filter((part) => !part.includes("="));
    assert.deepEqual(members, groups[0].nodes.map((node) => node.name));
    const weights = options.get("policy-priority").split(";").map((entry) => entry.split(":"));
    assert.equal(weights.length, names.length);
    for (const [index, member] of members.entries()) {
      const matches = weights.filter(([pattern]) => new RegExp(pattern).test(member));
      assert.equal(matches.length, 1);
      assert.equal(Number(matches[0][1]), expectedWeights[index]);
    }
    const { config, warnings } = await convertSurgeToClash(source, context);
    const group = config["proxy-groups"].find(({ name }) => name === "🇺🇸USA-ISP");
    assert.equal(group.type, "fallback");
    assert.deepEqual(group.proxies, members);
    assert.equal(group["policy-priority"], undefined);
    assert.equal(group.tolerance, undefined);
    assert.ok(warnings.some((warning) => warning.includes("weighted scoring unavailable")));
    assert.ok(!warnings.some((warning) => /unavailable members|invalid group|cyclic|empty group/.test(warning)));
  }
});

test("tenfold smart priorities allow 16 members and reject unsafe values", () => {
  const names = Array.from({ length: 17 }, (_, index) => `node-${index}`);
  const weights = orderedSmartPriority(names.slice(0, 16), "geometric-10").split(";");
  assert.equal(weights.length, 16);
  assert.equal(weights.at(-1), "^node-15$:1000000000000000");
  assert.throws(() => orderedSmartPriority(names, "geometric-10"), /Smart priority exceeds the supported range/);
});

test("ordered smart conversion skips unsupported nodes without changing order and rejects other weight formats safely", async () => {
  const source = `[Proxy]\ngood = ${vmess}\nbad = ${vmess}, unsupported-option=NEVER_LOG_THIS\n[Proxy Group]\nranked = smart, bad, good, policy-priority="^bad$:1;^good$:2"\n[Rule]\nFINAL,good`;
  const { config } = await convertSurgeToClash(source, context);
  assert.deepEqual(config["proxy-groups"].map(({ name, type, proxies }) => ({ name, type, proxies })), [{ name: "ranked", type: "fallback", proxies: ["good"] }]);
  for (const weight of [3, 10]) {
    const geometric = await convertSurgeToClash(source.replace("^good$:2", `^good$:${weight}`), context);
    assert.deepEqual(geometric.config["proxy-groups"], config["proxy-groups"]);
  }
  for (const priority of ["^bad$:2;^good$:1", "^bad$:0;^good$:2", "^bad$:NaN;^good$:2", "^bad$:1;^good$:4", "NEVER_LOG_THIS:1"]) {
    const { config, warnings } = await convertSurgeToClash(source.replace("^bad$:1;^good$:2", priority), context);
    assert.deepEqual(config["proxy-groups"], []);
    assert.ok(warnings.some((warning) => warning.includes("invalid group omitted")));
    assert.doesNotMatch(warnings.join("\n"), /NEVER_LOG_THIS|\^bad|\^good/);
  }
});

test("node conversion preserves quoted credentials, VMess transport, TLS verification and common proxy protocols", async () => {
  const fingerprint = "ab".repeat(32);
  const node = convertClashNode(`test = ${vmess}, encrypt-method=chacha20-ietf-poly1305, sni=sni.example.com, server-cert-verify-name=cert.example.com, server-cert-fingerprint-sha256=${fingerprint}, alpn="h2,http/1.1", ws=true, ws-path="/ws?a=1,b=2", ws-headers="Host:ws.example.com|X-Test:a:b", udp-relay=true`);
  assert.equal(node.uuid, uuid);
  assert.equal(node.cipher, "chacha20-poly1305");
  assert.equal(node.alterId, 0);
  assert.equal(node.servername, "sni.example.com");
  assert.equal(node["name-cert-verify"], "cert.example.com");
  assert.equal(node.fingerprint, fingerprint);
  assert.deepEqual(node.alpn, ["h2", "http/1.1"]);
  assert.equal(node["ws-opts"].path, "/ws?a=1,b=2");
  assert.equal(node["ws-opts"].headers["X-Test"], "a:b");
  assert.equal(node.udp, true);
  for (const protocol of ["trojan", "ss", "http", "https", "socks5", "socks5-tls"]) {
    const output = convertClashNode(`node = ${protocol}, [2001:db8::1], 443, password="0001,a=#secret", ${protocol === "ss" ? "encrypt-method=aes-128-gcm, obfs=tls, obfs-host=example.com" : "tfo=true"}`);
    assert.equal(output.password, "0001,a=#secret");
    assert.equal(output.server, "2001:db8::1");
  }
  const yaml = await renderClashProfile('[Proxy]\nnode = trojan, example.com, 443, password="0001,a=#secret"\n[Rule]\nFINAL,node', context);
  assert.equal(parse(yaml).proxies[0].password, "0001,a=#secret");
});

test("UDP relay defaults preserve VMess and Trojan support and explicit opt-outs", () => {
  const values = [vmess, "trojan, node.example.com, 443, password=TEST_ONLY"];
  for (const value of values) {
    assert.equal(convertClashNode(`node = ${value}`).udp, true);
    assert.equal(convertClashNode(`node = ${value}, udp-relay=true`).udp, true);
    assert.equal(convertClashNode(`node = ${value}, udp-relay=false`).udp, false);
    assert.throws(() => convertClashNode(`node = ${value}, udp-relay=invalid`));
  }
  for (const value of ["ss, node.example.com, 443, encrypt-method=aes-128-gcm, password=TEST_ONLY", "socks5, node.example.com, 1080", "socks5-tls, node.example.com, 443"]) {
    assert.equal(convertClashNode(`node = ${value}`).udp, undefined);
    assert.equal(convertClashNode(`node = ${value}, udp-relay=true`).udp, true);
    assert.equal(convertClashNode(`node = ${value}, udp-relay=false`).udp, false);
  }
});

test("QUIC blocking uses ProjectClash's final-outbound setting without replacing UDP support or routing", async () => {
  const source = `[Proxy]\nnode = ${vmess}\n[Proxy Group]\nAIProxy = select, node, DIRECT\nDirectFirst = select, DIRECT, node\n[Rule]\nDOMAIN-SUFFIX,local,DIRECT\nDOMAIN-SUFFIX,claude.ai,AIProxy\nFINAL,DirectFirst`;
  const baseline = await convertSurgeToClash(source, context);
  assert.equal(baseline.config["x-clash-block-quic"], undefined);
  // ProjectClash has no adaptive mode; Surge's per-policy default for proxies is closest to all-proxy.
  for (const [mode, expected] of [["all-proxy", "all-proxy"], ["all", "all"], ["always-allow", "always-allow"], ["per-policy", "all-proxy"]]) {
    const { config, warnings } = await convertSurgeToClash(`[General]\nblock-quic = ${mode}\n${source}`, context);
    assert.equal(config["x-clash-block-quic"], expected);
    const { "x-clash-block-quic": unused, ...rest } = config;
    assert.deepEqual(rest, baseline.config);
    assert.equal(config.proxies[0].udp, true);
    assert.ok(warnings.some((warning) => warning.includes("ProjectClash")));
    assert.equal(warnings.some((warning) => warning.includes("adaptive mode approximated by all-proxy")), mode === "per-policy");
    assert.ok(!warnings.some((warning) => warning.includes("unsupported setting omitted")));
    const yaml = parse(await renderClashProfile(`[General]\nblock-quic = ${mode}\n${source}`, context));
    assert.equal(yaml["x-clash-block-quic"], expected);
  }
  const { config, warnings } = await convertSurgeToClash(`[General]\nblock-quic = NEVER_LOG_THIS\n${source}`, context);
  assert.deepEqual(config, baseline.config);
  assert.ok(warnings.some((warning) => warning.includes("block-quic")));
  assert.doesNotMatch(warnings.join("\n"), /NEVER_LOG_THIS/);
});

test("node defaults retain Surge handshakes and explicit TCP Fast Open settings", () => {
  const plain = `node = vmess, node.example.com, 443, username=${uuid}, vmess-aead=true`;
  const node = convertClashNode(plain);
  assert.equal(node.cipher, "aes-128-gcm");
  assert.equal(node.alterId, 0);
  assert.equal(node.tls, undefined);
  assert.equal(node.network, undefined);
  assert.equal(node["skip-cert-verify"], undefined);
  assert.throws(() => convertClashNode(plain.replace(", vmess-aead=true", "")));
  assert.equal(convertClashNode(`${plain}, ws=true`)["ws-opts"].path, "/");
  for (const value of [vmess, "trojan, node.example.com, 443, password=TEST_ONLY", "https, node.example.com, 443", "socks5-tls, node.example.com, 443"]) {
    assert.equal(convertClashNode(`node = ${value}, tfo=true`).tfo, true);
    assert.equal(convertClashNode(`node = ${value}, tfo=false`).tfo, false);
    assert.throws(() => convertClashNode(`node = ${value}, tfo=invalid`));
    assert.throws(() => convertClashNode(`node = ${value}, sni=off`));
  }
});

test("per-node testing overrides are reported without exposing their values", async () => {
  const source = `[Proxy]\nnode = ${vmess}, test-url=https://NEVER_LOG_THIS.example/, test-timeout=7\n[Rule]\nFINAL,node`;
  const { config, warnings } = await convertSurgeToClash(source, context);
  assert.equal(config.proxies.length, 1);
  assert.ok(warnings.some((warning) => warning.includes("test-url")));
  assert.ok(warnings.some((warning) => warning.includes("test-timeout")));
  assert.doesNotMatch(warnings.join("\n"), /NEVER_LOG_THIS/);
});

test("automatic groups preserve Surge defaults and distinguish latency filters from test timeouts", async () => {
  const source = `[Proxy]\nnode = ${vmess}\n[Proxy Group]\nbackup = fallback, node\nauto = url-test, node\nexplicit = url-test, node, interval=300, tolerance=0, timeout=1, url=https://NEVER_LOG_THIS.example/\n[Rule]\nFINAL,backup`;
  for (const general of ["", "[General]\ntest-timeout = 9\nproxy-test-url = https://test.example/\n"]) {
    const { config, warnings } = await convertSurgeToClash(general + source, context);
    const [backup, auto, explicit] = config["proxy-groups"];
    assert.equal(backup.interval, 600);
    assert.equal(auto.interval, 600);
    assert.equal(auto.tolerance, 100);
    assert.equal(backup.tolerance, undefined);
    assert.equal(explicit.interval, 300);
    assert.equal(explicit.tolerance, 0);
    for (const group of [backup, auto, explicit]) {
      assert.equal(group.url, general ? "https://test.example/" : "http://bing.com/");
      assert.equal(group.timeout, general ? 9000 : 5000);
    }
    assert.ok(warnings.some((warning) => warning.includes("latency filter")));
    assert.ok(warnings.some((warning) => warning.includes("legacy url")));
    assert.doesNotMatch(warnings.join("\n"), /NEVER_LOG_THIS/);
  }
  for (const value of ["-1", "NaN", "1.5"]) {
    const { config } = await convertSurgeToClash(source.replace("tolerance=0", `tolerance=${value}`), context);
    assert.ok(!config["proxy-groups"].some((group) => group.name === "explicit"));
  }
});

test("LAN expansion includes local domains and special networks without changing DNS resolution flags", async () => {
  for (const suffix of ["", ",no-resolve"]) {
    const warnings = [];
    const { rules } = await convertClashRules([`RULE-SET,LAN,DIRECT${suffix}`, "FINAL,DIRECT"], new Set(["DIRECT"]), context.requestUrl, context.token, (warning) => warnings.push(warning));
    assert.equal(rules[0], "DOMAIN-SUFFIX,local,DIRECT");
    for (const network of ["0.0.0.0/8", "192.0.0.0/24", "192.0.2.0/24", "224.0.0.0/4", "192.168.0.0/16"]) {
      assert.ok(rules.includes(`IP-CIDR,${network},DIRECT${suffix}`));
    }
    assert.ok(rules.includes(`IP-CIDR6,fe80::/10,DIRECT${suffix}`));
    assert.equal(rules.at(-1), "MATCH,DIRECT");
    assert.deepEqual(warnings, []);
  }
});

test("unsupported nodes, empty groups, cycles and dangling rules are removed without exposing values in warnings", async () => {
  const source = `[General]\nnew-setting = NEVER_LOG_THIS\n[Proxy]\ngood = trojan, example.com, 443, password=NEVER_LOG_THIS\nbad = ${vmess}, unknown-auth=NEVER_LOG_THIS\n[Proxy Group]\nempty = fallback, bad\ncycle1 = select, cycle2\ncycle2 = select, cycle1\nmain = select, empty, cycle1, good, DIRECT, REJECT\n[Rule]\nDOMAIN,secret.example,empty\nNEW-RULE,NEVER_LOG_THIS,main\nFINAL,main,dns-failed\n[Script]\nsecret = NEVER_LOG_THIS\n`;
  const { config, warnings } = await convertSurgeToClash(source, context);
  assert.deepEqual(config.proxies.map(({ name }) => name), ["good"]);
  assert.deepEqual(config["proxy-groups"], [{ name: "main", type: "select", proxies: ["good", "DIRECT", "REJECT"] }]);
  assert.deepEqual(config.rules, ["MATCH,main"]);
  assert.doesNotMatch(warnings.join("\n"), /NEVER_LOG_THIS|secret\.example/);
  for (const value of ["snell, example.com, 443, psk=TEST_ONLY", vmess.replace("vmess-aead=true", "vmess-aead=false"), `${vmess}, skip-cert-verify=invalid`, "__proto__, example.com, 443"]) {
    await assert.rejects(convertSurgeToClash(`[Proxy]\nbad = ${value}\n[Rule]\nFINAL,DIRECT`, context), (error) => error.status === 422);
  }
});

test("new supported settings and rules flow from Surge without editing a Clash template", async () => {
  const source = `[General]\ndns-server = 9.9.9.9\nipv6 = true\nread-etc-hosts = false\n[Proxy]\nnode = trojan, example.com, 443, password=TEST_ONLY\n[Rule]\nDOMAIN-SUFFIX,new.example,DIRECT\nDEST-PORT,123,REJECT\nFINAL,node\n`;
  const { config } = await convertSurgeToClash(source, context);
  assert.deepEqual(config.dns.nameserver, ["9.9.9.9"]);
  assert.deepEqual(config.dns["proxy-server-nameserver"], ["9.9.9.9"]);
  assert.equal(config.ipv6, true);
  assert.equal(config.dns["use-system-hosts"], false);
  assert.deepEqual(config.rules, ["DOMAIN-SUFFIX,new.example,DIRECT", "DST-PORT,123,REJECT", "MATCH,node"]);
});

test("policy icons preserve group members, visibility and rules across supported group types", async () => {
  const icon = "https://icons.example.com/brand.png?size=144,144";
  const source = `[Proxy]\nnode = trojan, example.com, 443, password=TEST_ONLY\n[Proxy Group]\nmain = select, backup, auto, DIRECT, icon-url="${icon}"\nbackup = fallback, node, DIRECT, icon-url="${icon}", hidden=true\nauto = url-test, node, icon-url="${icon}"\n[Rule]\nDOMAIN-SUFFIX,example.com,backup\nFINAL,main\n`;
  const { config, warnings } = await convertSurgeToClash(source, context);
  const plain = await convertSurgeToClash(source.replaceAll(`, icon-url="${icon}"`, ""), context);
  const { "proxy-groups": groups, ...rest } = config;
  assert.equal(groups.length, 3);
  for (const group of groups) assert.equal(group.icon, icon);
  assert.deepEqual(groups.map(({ icon: unused, ...group }) => group), plain.config["proxy-groups"]);
  assert.deepEqual(rest, Object.fromEntries(Object.entries(plain.config).filter(([key]) => key !== "proxy-groups")));
  assert.deepEqual(warnings, plain.warnings);
});

test("remote rule conversion filters unsupported syntax and domain sets without inventing a catch-all", () => {
  const result = convertClashRuleSet("# comment\nDOMAIN-SUFFIX,example.com\nIP-CIDR,192.0.2.0/24,no-resolve\nDEST-PORT,443\nUSER-AGENT,TEST_ONLY\nRULE-SET,https://example.com/nested\nFINAL,DIRECT\n");
  assert.match(result, /3 unsupported rule entries omitted/);
  assert.match(result, /DST-PORT,443/);
  assert.doesNotMatch(result, /USER-AGENT|RULE-SET|FINAL|MATCH|TEST_ONLY/);
  assert.equal(convertClashRuleSet(".example.com\nexact.example\ninvalid,entry", "DOMAIN-SET"), "# AtlasRouter: 1 unsupported rule entries omitted\nDOMAIN-SUFFIX,example.com\nDOMAIN,exact.example\n");
});

test("rule sources use stable ids, preserve intervals, and reject arbitrary unregistered destinations", async () => {
  const source = await ruleSource(["RULE-SET", "https://rules.example.com/source.list"]);
  assert.deepEqual(await ruleSource(["RULE-SET", source.url]), source);
  assert.notEqual((await ruleSource(["DOMAIN-SET", source.url])).id, source.id);
  assert.equal(await findClashRuleSource(`${source.id}.txt`), null);
  assert.equal(await findClashRuleSource("https://rules.example.com/source.list"), null);
  for (const url of ["http://example.com/rules", "https://localhost/a", "https://127.0.0.1/a", "https://user:pass@example.com/a"]) assert.equal(await ruleSource(["RULE-SET", url]), null);
  const { providers } = await convertClashRules([`RULE-SET,${source.url},DIRECT,update-interval=600`, "FINAL,DIRECT"], new Set(["DIRECT"]), context.requestUrl, context.token, () => {});
  assert.equal(providers[source.id].interval, 600);
  assert.equal(providers[source.id].url, `${context.requestUrl}/rules/${source.id}.txt?token=${context.token}`);
});

test("repository rule sets are fetched directly without a token; lookalike sources keep the converter", async () => {
  const lookalikes = [
    "https://cdn.jsdelivr.net/gh/someone/AtlasRouter@develop/surge/rule-sets/WeChat.list",
    "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rules.list",
    "https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/WeChat.list?token=x",
    "https://fastly.jsdelivr.net/gh/jarieshan/AtlasRouter@develop/surge/rule-sets/WeChat.list",
  ];
  const lines = [`RULE-SET,${wechatUrl},WeChat,no-resolve`, `DOMAIN-SET,${customDirectUrl},DIRECT`, ...lookalikes.map((url) => `RULE-SET,${url},DIRECT`), "FINAL,DIRECT"];
  const { providers } = await convertClashRules(lines, new Set(["DIRECT", "WeChat"]), context.requestUrl, context.token, assert.fail);
  const wechat = await ruleSource(["RULE-SET", wechatUrl]);
  assert.deepEqual(providers[wechat.id], { type: "http", behavior: "classical", format: "text", url: wechatUrl, interval: 86400 });
  for (const parts of [["DOMAIN-SET", customDirectUrl], ...lookalikes.map((url) => ["RULE-SET", url])]) {
    const source = await ruleSource(parts);
    assert.equal(providers[source.id].url, `${context.requestUrl}/rules/${source.id}.txt?token=${context.token}`);
  }
});

test("native MagicRule providers retain flags and intervals and only map registered Surge artifacts", async () => {
  const surge = magicRuleUrl("Copilot", "surge");
  const fallbackSources = [
    ["RULE-SET", surge.replace("magicrule.pages.dev", "other.example")],
    ["RULE-SET", surge.replace("Copilot_rules_", "Unregistered_rules_")],
    ["RULE-SET", `${surge}?private=TEST_ONLY`],
    ["RULE-SET", magicRuleUrl("Copilot", "mihomo")],
    ["DOMAIN-SET", surge],
  ];
  const { providers, rules } = await convertClashRules([
    `RULE-SET,${surge},DIRECT,no-resolve,update-interval=600`,
    `RULE-SET,${surge},REJECT,update-interval=600`,
    ...fallbackSources.map((parts) => `${parts.join(",")},DIRECT`),
    "FINAL,DIRECT",
  ], new Set(["DIRECT", "REJECT"]), context.requestUrl, context.token, assert.fail);
  assert.equal(providers.Copilot.interval, 600);
  assert.equal(providers.Copilot.url, magicRuleUrl("Copilot", "mihomo"));
  assert.equal(providers.Copilot.format, "yaml");
  assert.ok(rules.includes("RULE-SET,Copilot,DIRECT,no-resolve"));
  assert.ok(rules.includes("RULE-SET,Copilot,REJECT"));
  assert.equal(Object.keys(providers).length, 6);
  for (const parts of fallbackSources) {
    const source = await ruleSource(parts);
    assert.equal(providers[source.id].url, `${context.requestUrl}/rules/${source.id}.txt?token=${context.token}`);
  }
});

test("rule downloads are bounded, never forward credentials, and redact upstream errors", async () => {
  const source = { url: "https://rules.example.com/rules.list", kind: "RULE-SET" };
  const result = await downloadClashRuleSet(source, async (url, options) => {
    assert.equal(url, source.url);
    assert.equal(options.redirect, "manual");
    assert.deepEqual(Object.keys(options.headers).sort(), ["accept", "user-agent"]);
    return new Response("DOMAIN,example.com\nUSER-AGENT,unsupported");
  });
  assert.match(result, /1 unsupported rule entries omitted/);
  for (const fetcher of [
    async () => new Response(null, { status: 302, headers: { location: "https://internal.local" } }),
    async () => new Response("<html>private data</html>"),
    async () => new Response("x".repeat(4 * 1024 * 1024 + 1)),
    async () => { throw new Error("NEVER_LOG_THIS"); },
  ]) await assert.rejects(downloadClashRuleSet(source, fetcher), (error) => error.status === 502 && !error.message.includes("NEVER_LOG_THIS"));
});
