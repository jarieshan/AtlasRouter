import assert from "node:assert/strict";
import test from "node:test";
import { ASSETS } from "../src/generated/assets.js";
import { renderSurgeProfile } from "../src/render-surge.js";
import { parsePoolNodes } from "../src/node-pool.js";
import { buildSubscriptionUrl, readSubscriptionOptions } from "../src/subscription-options.js";
import { TENCENT_OA_MODULE } from "../src/tencent-oa.js";

const requestUrl = "https://atlas.example/AtlasRouter";
const token = `ar_${"a".repeat(64)}`;
const nodes = parsePoolNodes([{ id: "node", line: "🇺🇸 Test ISP = trojan, example.com, 443, password=TEST_ONLY" }]);
const input = { requestUrl, token, nodes, groups: [{ group: "🇺🇸USA-ISP", nodes }] };
const local = ["127.0.0.1", "localhost", "*.local", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"];
const banks = ["yunbusiness.ccb.com", "www.abchina.com.cn", "*.psbc.com", "*.bosc.cn"];
const companyNetworks = ["9.0.0.0/8", "30.0.0.0/8", "21.0.0.0/8", "22.0.0.0/8", "26.0.0.0/8", "28.0.0.0/7"];
const companyDomains = [
  "oa.com", "*.oa.com", "woa.com", "*.woa.com",
  "*tencentyun.com", "*tencent-cloud.net", "*tencent-cloud.com", "*tencentcloud.com",
  "*tencentcloudapi.com", "*tencentcloudcr.com", "*tcloudbase.com", "*tcloudbaseapp.com",
  "*qcloudimg.com", "*qcloud.com", "*cdn-go.cn", "*workbuddy.cn",
];
const moduleList = () => ASSETS.modules[TENCENT_OA_MODULE].match(/^skip-proxy = (.+)$/m)[1].split(", ");
const profileList = () => ASSETS.template.match(/^skip-proxy = (.+)$/m)[1].split(", ");

function ipv4Range(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/.exec(value);
  if (!match) return null;
  const address = match.slice(1, 5).reduce((sum, part) => sum * 256 + Number(part), 0);
  const size = 2 ** (32 - Number(match[5] ?? 32));
  return [address - (address % size), address - (address % size) + size];
}

test("default skip-proxy keeps local networks and bank exceptions", () => {
  assert.deepEqual(profileList(), ["127.0.0.1", "localhost", "*.local", "10.0.0.0/8", ...local.slice(3), ...banks]);
  for (const list of [profileList(), moduleList()]) assert.ok(!list.includes("100.64.0.0/10"), "Tailnet requests must reach Surge");
});

test("Tencent OA module replaces skip-proxy with the default entries plus company exceptions on Surge Mac only", () => {
  assert.deepEqual(Object.keys(ASSETS.modules), [TENCENT_OA_MODULE]);
  const module = ASSETS.modules[TENCENT_OA_MODULE];
  assert.match(module, /^#!name=Tencent OA Compatibility$/m);
  assert.match(module, /^#!system=mac$/m);
  assert.deepEqual([...module.matchAll(/^\[([^\]]+)\]$/gm)].map((match) => match[1]), ["General"]);
  assert.doesNotMatch(module, /%APPEND%|%INSERT%/);
  const list = moduleList();
  assert.deepEqual(list, [...local.slice(0, 3), "10.0.0.0/7", ...local.slice(3), ...banks, ...companyNetworks, ...companyDomains]);
  assert.equal(new Set(list).size, list.length);
  const ranges = list.map(ipv4Range).filter(Boolean);
  for (const entry of profileList()) {
    const range = ipv4Range(entry);
    assert.ok(range ? ranges.some(([start, end]) => start <= range[0] && range[1] <= end) : list.includes(entry), entry);
  }
  const config = renderSurgeProfile(input);
  assert.ok(config.split("\n").includes(`# - Tencent OA Compatibility: ${requestUrl}/modules/${TENCENT_OA_MODULE}?token=${token}`));
});

test("legacy tencent_oa links are opt-in, validate options, and survive managed subscription updates", () => {
  assert.deepEqual(readSubscriptionOptions(new URLSearchParams("doh=1&tencent_oa=1")), { client: "surge", doh: true, tencentOa: true });
  assert.equal(readSubscriptionOptions(new URLSearchParams("client=clash&tencent_oa=0")).tencentOa, false);
  for (const query of ["tencent_oa=", "tencent_oa=true", "tencent_oa=1&tencent_oa=1", "tencent_oa=0&tencent_oa=1", "client=clash&tencent_oa=1"]) {
    assert.throws(() => readSubscriptionOptions(new URLSearchParams(query)), (error) => error.status === 400);
  }
  assert.throws(() => buildSubscriptionUrl(requestUrl, token, { client: "clash", tencentOa: true }), (error) => error.status === 400);
  const plain = renderSurgeProfile(input);
  const disabled = renderSurgeProfile({ ...input, options: { tencentOa: false } });
  assert.equal(plain, disabled);
  const plainSkip = plain.match(/^skip-proxy = (.+)$/m)[1].split(", ");
  assert.deepEqual(plainSkip, profileList());
  for (const value of [...companyNetworks, ...companyDomains, "10.0.0.0/7"]) assert.ok(!plainSkip.includes(value), value);
  assert.doesNotMatch(plain, /TencentOA|10\.28\.0\.21|tencent_oa=/);
  const options = { tencentOa: true, doh: true };
  const enabled = renderSurgeProfile({ ...input, requestUrl: `${requestUrl}?untrusted=x#fragment`, options });
  assert.equal(enabled.match(/^#!MANAGED-CONFIG (\S+)/)[1], `${requestUrl}?token=${token}&doh=1&tencent_oa=1`);
  assert.match(enabled, /^encrypted-dns-server = https:\/\/cloudflare-dns\.com\/dns-query, https:\/\/dns\.google\/dns-query$/m);
  assert.deepEqual(enabled.match(/^hijack-dns\s*=.*$/gm), ["hijack-dns = 8.8.8.8:53, 8.8.4.4:53"]);
  assert.match(enabled, /^FINAL,Proxy,dns-failed$/m);
  assert.doesNotMatch(enabled, /{{|untrusted=|#fragment/);
  assert.equal(enabled.split("[Proxy]\n")[1].split("[Rule]")[0], plain.split("[Proxy]\n")[1].split("[Rule]")[0]);
});

test("legacy tencent_oa links replace skip-proxy with the module list and preserve DNS and rules", () => {
  const plain = renderSurgeProfile(input);
  const config = renderSurgeProfile({ ...input, options: { tencentOa: true } });
  assert.deepEqual(config.match(/^skip-proxy = (.+)$/gm), [`skip-proxy = ${moduleList().join(", ")}`]);
  assert.doesNotMatch(config, /TencentOA|10\.28\.0\.21/);
  assert.equal(config.split("[Host]\n")[1].split("[Proxy]")[0], plain.split("[Host]\n")[1].split("[Proxy]")[0]);
  const withoutOverrides = (value) => value.replace(/^#!MANAGED-CONFIG .*\n/m, "").replace(/^skip-proxy = .*\n/m, "");
  assert.equal(withoutOverrides(config), withoutOverrides(plain));
  const lines = config.split("[Rule]\n")[1].split("\n").filter(Boolean);
  assert.deepEqual(lines.slice(0, 2), ["RULE-SET,SYSTEM,DIRECT", "RULE-SET,LAN,DIRECT,no-resolve"]);
  assert.deepEqual(lines.slice(-2), ["GEOIP,CN,DIRECT", "FINAL,Proxy,dns-failed"]);
});
