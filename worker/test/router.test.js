import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest } from "../src/index.js";

const env = {
  SUBSCRIBE_TOKEN: "test-token",
  NODES_TEXT: "US-01 美国 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
};

test("rejects unauthorized requests", async () => {
  const response = await handleRequest(new Request("https://atlas.example/surge"), env);

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Unauthorized");
});

test("renders Surge profile with separate rules config", async () => {
  const response = await handleRequest(new Request("https://atlas.example/surge?token=test-token"), env);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /^#!MANAGED-CONFIG https:\/\/atlas\.example\/surge\?token=test-token/m);
  assert.match(body, /US-01 美国 = trojan, us\.example\.com, 443, password=secret, sni=us\.example\.com/);
  assert.match(body, /🇺🇸 Airport_US = url-test, include-all-proxies=true/);
  assert.match(body, /DOMAIN-SUFFIX,longbridge\.global,DIRECT/);
  assert.match(body, /DOMAIN-SUFFIX,kaggle\.com,🇺🇸 Airport_US/);
  assert.match(body, /RULE-SET,SYSTEM,DIRECT/);
  assert.match(body, /RULE-SET,https:\/\/cdn\.jsdelivr\.net\/gh\/blackmatrix7\/ios_rule_script@master\/rule\/Surge\/OpenAI\/OpenAI\.list,🤖 AIProxy,update-interval=86400/);
  assert.match(body, /FINAL,♻️ Auto/);
});

test("falls back regional rules when no matching region group exists", async () => {
  const response = await handleRequest(new Request("https://atlas.example/surge?token=test-token"), {
    ...env,
    NODES_TEXT: "Generic-01 = trojan, generic.example.com, 443, password=secret",
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(body, /🇺🇸 Airport_US = url-test/);
  assert.match(body, /DOMAIN-SUFFIX,kaggle\.com,♻️ Auto/);
  assert.match(body, /DOMAIN-SUFFIX,buyee\.jp,♻️ Auto/);
});

test("returns 404 for unknown route", async () => {
  const response = await handleRequest(new Request("https://atlas.example/unknown?token=test-token"), env);

  assert.equal(response.status, 404);
});
