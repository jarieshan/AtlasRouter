import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASSETS } from "../src/generated/assets.js";
import { renderSurgeProfile } from "../src/render-surge.js";
import { parsePoolNodes } from "../src/node-pool.js";
import { buildSubscriptionUrl, readSubscriptionOptions } from "../src/subscription-options.js";
import { surgeSections } from "../src/surge-format.js";

const requestUrl = "https://atlas.example/AtlasRouter";
const token = `ar_${"a".repeat(64)}`;
const nodes = parsePoolNodes([{ id: "node", line: "🇺🇸 Test ISP = trojan, example.com, 443, password=TEST_ONLY" }]);
const input = { requestUrl, token, nodes, groups: [{ group: "🇺🇸USA-ISP", nodes }] };
const local = ["127.0.0.1", "localhost", "*.local", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16"];
const banks = ["yunbusiness.ccb.com", "www.abchina.com.cn", "*.psbc.com", "*.bosc.cn"];
const companyNetworks = ["9.0.0.0/8", "30.0.0.0/8", "21.0.0.0/8", "22.0.0.0/8", "26.0.0.0/8", "28.0.0.0/7"];
const companyDomains = [
  "oa.com", "*.oa.com", "woa.com", "*.woa.com",
  "*tencentyun.com", "*tencent-cloud.net", "*tencent-cloud.com", "*tencentcloud.com",
  "*tencentcloudapi.com", "*tencentcloudcr.com", "*tencentcos.cn", "*tcloudbase.com", "*tcloudbaseapp.com",
  "*qcloudimg.com", "*qcloud.com", "*cdn-go.cn", "*workbuddy.cn",
];
const profileList = () => ASSETS.template.match(/^skip-proxy = (.+)$/m)[1].split(", ");
const tencentOaList = () => ASSETS.tencentOa.match(/^skip-proxy = (.+)$/m)[1].split(", ");

function ipv4Range(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/.exec(value);
  if (!match) return null;
  const address = match.slice(1, 5).reduce((sum, part) => sum * 256 + Number(part), 0);
  const size = 2 ** (32 - Number(match[5] ?? 32));
  return [address - (address % size), address - (address % size) + size];
}

test("default skip-proxy keeps local networks and bank exceptions without Tencent OA entries", () => {
  assert.deepEqual(profileList(), [...local.slice(0, 3), "10.0.0.0/8", ...local.slice(3), ...banks]);
  for (const doh of [false, true]) {
    const config = renderSurgeProfile({ ...input, options: { doh } });
    assert.equal(config, renderSurgeProfile({ ...input, options: { doh, tencentOa: false } }));
    assert.deepEqual(config.match(/^skip-proxy = (.+)$/gm), [`skip-proxy = ${profileList().join(", ")}`]);
    assert.doesNotMatch(config, /TencentOA|10\.28\.0\.21|tencent_oa=/);
  }
});

test("Tencent OA list repeats the default entries and adds company exceptions", () => {
  const list = tencentOaList();
  assert.deepEqual(ASSETS.tencentOa.split("\n").filter((line) => line && !line.startsWith("#")), [`skip-proxy = ${list.join(", ")}`]);
  assert.deepEqual(list, [...local.slice(0, 3), "10.0.0.0/7", ...local.slice(3), ...banks, ...companyNetworks, ...companyDomains]);
  assert.equal(new Set(list).size, list.length);
  const ranges = list.map(ipv4Range).filter(Boolean);
  for (const entry of profileList()) {
    const range = ipv4Range(entry);
    assert.ok(range ? ranges.some(([start, end]) => start <= range[0] && range[1] <= end) : list.includes(entry), entry);
  }
});

test("Tencent OA rule set mirrors the exact IP, hostname and wildcard entries in skip-proxy", () => {
  const file = new URL("../../surge/rule-sets/TencentOA.list", import.meta.url);
  const rules = readFileSync(file, "utf8").split("\n").filter((line) => line && !line.startsWith("#"));
  const expected = tencentOaList().map((entry) => {
    if (ipv4Range(entry)) return `IP-CIDR,${entry.includes("/") ? entry : `${entry}/32`}`;
    return `${entry.includes("*") ? "DOMAIN-WILDCARD" : "DOMAIN"},${entry}`;
  });
  assert.deepEqual(rules, expected);
});

test("tencent_oa=1 enables the branch's direct rule set with system DNS and survives managed updates", () => {
  assert.deepEqual(readSubscriptionOptions(new URLSearchParams("tencent_oa=1")), { client: "surge", doh: true, tencentOa: true, wifiAssist: false, vless: false });
  assert.equal(readSubscriptionOptions(new URLSearchParams("client=clash&tencent_oa=0")).tencentOa, false);
  for (const query of ["tencent_oa=", "tencent_oa=true", "tencent_oa=1&tencent_oa=1", "tencent_oa=0&tencent_oa=1", "client=clash&tencent_oa=1"]) {
    assert.throws(() => readSubscriptionOptions(new URLSearchParams(query)), (error) => error.status === 400);
  }
  assert.throws(() => buildSubscriptionUrl(requestUrl, token, { client: "clash", tencentOa: true }), (error) => error.status === 400);
  const withoutOverrides = (value) => value.replace(/^#!MANAGED-CONFIG .*\n/m, "").replace(/^skip-proxy = .*\n/m, "");
  for (const repositoryRulesRef of ["develop", "master"]) for (const doh of [false, true]) {
    const plain = renderSurgeProfile({ ...input, repositoryRulesRef, options: { doh } });
    const enabled = renderSurgeProfile({ ...input, repositoryRulesRef, requestUrl: `${requestUrl}?untrusted=x#fragment`, options: { doh, tencentOa: true } });
    assert.equal(enabled.match(/^#!MANAGED-CONFIG (\S+)/)[1], `${requestUrl}?token=${token}${doh ? "" : "&doh=0"}&tencent_oa=1`);
    assert.deepEqual(enabled.match(/^skip-proxy = (.+)$/gm), [`skip-proxy = ${tencentOaList().join(", ")}`]);
    assert.doesNotMatch(enabled, /{{|untrusted=|#fragment|10\.28\.0\.21/);
    assert.doesNotMatch(plain, /TencentOA\.list/);
    const url = `https://cdn.jsdelivr.net/gh/jarieshan/AtlasRouter@${repositoryRulesRef}/surge/rule-sets/TencentOA.list`;
    const rule = `RULE-SET,${url},DIRECT,no-resolve`;
    const dns = `RULE-SET:${url} = server:system`;
    const sections = surgeSections(enabled);
    const rules = sections.get("rule");
    const hosts = sections.get("host");
    assert.deepEqual(rules.filter((line) => line.includes("/TencentOA.list")), [rule]);
    assert.deepEqual(hosts.filter((line) => line.includes("/TencentOA.list")), [dns]);
    assert.ok(rules.indexOf(rule) > rules.findIndex((line) => line.includes("/CustomReject.list,")));
    assert.ok(rules.indexOf(rule) < rules.findIndex((line) => line.includes("/CustomDirect.list,")));
    assert.equal(hosts[0], dns);
    assert.equal(withoutOverrides(enabled).replace(`${rule}\n`, "").replace(`${dns}\n`, ""), withoutOverrides(plain));
  }
});

test("profiles do not list a Tencent OA module", () => {
  assert.deepEqual(Object.keys(ASSETS.modules), []);
  assert.match(renderSurgeProfile({ ...input, options: { tencentOa: true } }), /^# Available modules:\n# - None\n/m);
});
