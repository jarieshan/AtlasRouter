import assert from "node:assert/strict";
import test from "node:test";

import { parseNodesJson, renderProxyLine, renderProxyLines } from "../src/nodes.js";

test("renders supported structured node types", () => {
  const nodes = parseNodesJson(JSON.stringify([
    {
      name: "US-01",
      type: "trojan",
      server: "us.example.com",
      port: 443,
      password: "secret",
      sni: "us.example.com",
      skipCertVerify: true,
    },
    {
      name: "JP-01",
      type: "vmess",
      server: "jp.example.com",
      port: 443,
      uuid: "00000000-0000-4000-8000-000000000000",
    },
  ]));

  assert.equal(
    renderProxyLines(nodes),
    [
      "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com, skip-cert-verify=true",
      "JP-01 = vmess, jp.example.com, 443, username=00000000-0000-4000-8000-000000000000",
    ].join("\n"),
  );
});

test("supports raw Surge proxy syntax", () => {
  assert.equal(
    renderProxyLine({
      name: "Raw-01",
      surgeProxy: "trojan, raw.example.com, 443, password=secret, sni=raw.example.com",
    }),
    "Raw-01 = trojan, raw.example.com, 443, password=secret, sni=raw.example.com",
  );
});

test("rejects empty node list", () => {
  assert.throws(() => parseNodesJson("[]"), /non-empty array/);
});
