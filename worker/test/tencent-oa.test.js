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
const networks = ["10.0.0.0/7", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.1", "169.254.0.0/16", "9.0.0.0/8", "30.0.0.0/8", "21.0.0.0/8", "22.0.0.0/8", "26.0.0.0/8", "28.0.0.0/7"];

test("Tencent OA is opt-in, validates options, and survives managed subscription updates", () => {
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
  for (const value of networks) assert.ok(!plainSkip.includes(value), value);
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

test("Tencent OA appends comma-separated proxy exceptions and preserves DNS and rules", () => {
  const plain = renderSurgeProfile(input);
  const config = renderSurgeProfile({ ...input, options: { tencentOa: true } });
  const skip = config.match(/^skip-proxy = (.+)$/m)[1].split(", ");
  const original = ASSETS.template.match(/^skip-proxy = (.+)$/m)[1].split(",").map((value) => value.trim());
  assert.equal(new Set(skip).size, skip.length);
  assert.ok(skip.every((value) => !value.includes("、")));
  for (const value of [...original, ...networks]) assert.ok(skip.includes(value), value);
  assert.equal(ASSETS.tencentOa.domains.length, 14);
  assert.deepEqual(skip, [...original, ...networks,
    "oa.com", "*.oa.com", "woa.com", "*.woa.com",
    "*tencentyun.com", "*tencent-cloud.net", "*tencent-cloud.com", "*tencentcloud.com",
    "*tencentcloudapi.com", "*tencentcloudcr.com", "*tcloudbase.com", "*tcloudbaseapp.com",
    "*qcloudimg.com", "*qcloud.com", "*cdn-go.cn", "*workbuddy.cn",
  ]);
  assert.doesNotMatch(config, /TencentOA|10\.28\.0\.21/);
  assert.equal(config.split("[Host]\n")[1].split("[Proxy]")[0], plain.split("[Host]\n")[1].split("[Proxy]")[0]);
  const withoutOverrides = (value) => value.replace(/^#!MANAGED-CONFIG .*\n/m, "").replace(/^skip-proxy = .*\n/m, "");
  assert.equal(withoutOverrides(config), withoutOverrides(plain));
  const lines = config.split("[Rule]\n")[1].split("[MITM]")[0].split("\n").filter(Boolean);
  assert.deepEqual(lines.slice(0, 2), ["RULE-SET,SYSTEM,DIRECT", "RULE-SET,LAN,DIRECT,no-resolve"]);
  assert.deepEqual(lines.slice(-2), ["GEOIP,CN,DIRECT", "FINAL,Proxy,dns-failed"]);
});
