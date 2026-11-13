import assert from "node:assert/strict";
import test from "node:test";
import { ASSETS } from "../src/generated/assets.js";
import { renderSurgeProfile } from "../src/render-surge.js";
import { parsePoolNodes } from "../src/node-pool.js";
import { buildSubscriptionUrl, readSubscriptionOptions } from "../src/subscription-options.js";

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
const profileList = () => ASSETS.template.match(/^skip-proxy = (.+)$/m)[1].split(", ");

test("default skip-proxy keeps local networks, bank exceptions and Tencent OA exceptions", () => {
  const list = profileList();
  assert.deepEqual(list, [...local.slice(0, 3), "10.0.0.0/7", ...local.slice(3), ...banks, ...companyNetworks, ...companyDomains]);
  assert.equal(new Set(list).size, list.length);
  assert.ok(!list.includes("100.64.0.0/10"), "Tailnet requests must reach Surge");
  for (const doh of [false, true]) {
    const config = renderSurgeProfile({ ...input, options: { doh } });
    assert.deepEqual(config.match(/^skip-proxy = (.+)$/gm), [`skip-proxy = ${list.join(", ")}`]);
    assert.doesNotMatch(config, /TencentOA|10\.28\.0\.21/);
  }
});

test("profiles no longer list a Tencent OA module", () => {
  assert.deepEqual(Object.keys(ASSETS.modules), []);
  assert.match(renderSurgeProfile(input), /^# Available modules:\n# - None\n/m);
});

test("legacy tencent_oa links still validate and render the default profile", () => {
  assert.deepEqual(readSubscriptionOptions(new URLSearchParams("tencent_oa=1")), { client: "surge", doh: true, tencentOa: true });
  assert.equal(readSubscriptionOptions(new URLSearchParams("client=clash&tencent_oa=0")).tencentOa, false);
  for (const query of ["tencent_oa=", "tencent_oa=true", "tencent_oa=1&tencent_oa=1", "tencent_oa=0&tencent_oa=1", "client=clash&tencent_oa=1"]) {
    assert.throws(() => readSubscriptionOptions(new URLSearchParams(query)), (error) => error.status === 400);
  }
  assert.throws(() => buildSubscriptionUrl(requestUrl, token, { client: "clash", tencentOa: true }), (error) => error.status === 400);
  const plain = renderSurgeProfile(input);
  const legacy = renderSurgeProfile({ ...input, requestUrl: `${requestUrl}?untrusted=x#fragment`, options: { tencentOa: true } });
  assert.equal(legacy.match(/^#!MANAGED-CONFIG (\S+)/)[1], `${requestUrl}?token=${token}&tencent_oa=1`);
  assert.doesNotMatch(legacy, /{{|untrusted=|#fragment/);
  const withoutManagedUrl = (value) => value.replace(/^#!MANAGED-CONFIG .*\n/m, "");
  assert.equal(withoutManagedUrl(legacy), withoutManagedUrl(plain));
});
