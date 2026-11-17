import assert from "node:assert/strict";
import test from "node:test";

import { parseNodesConfig, renderProxyLines, serializeNodesConfig, subscriptionNodes } from "../src/nodes.js";

test("subscription names replace compact region/type separators and retain numbered suffixes", () => {
  const names = ["🇭🇰 HongKong-ISP-1", "🇭🇰 HK-IDC-1", "🇺🇸 US(LA)-WARP-1", "🇭🇰 Hong-Kong-isp-2",
    "🇭🇰 HongKong - ISP 1", "🇭🇰 HongKong-ISPs-1"];
  const nodes = parseNodesConfig({ group: "test", value: names.map((name) => `${name} = direct`) });
  const before = structuredClone(nodes);
  assert.deepEqual(subscriptionNodes(nodes).map((node) => node.name), ["🇭🇰 HongKong ISP-1", "🇭🇰 HK IDC-1",
    "🇺🇸 US(LA) WARP-1", "🇭🇰 Hong-Kong isp-2", "🇭🇰 HongKong - ISP 1", "🇭🇰 HongKong-ISPs-1"]);
  assert.deepEqual(nodes, before);
});

test("subscription names resolve collisions consistently and update underlying proxy references", () => {
  const nodes = parseNodesConfig({ group: "test", value: [
    "🇭🇰 HK-ISP-1 = socks5, node.example.com, 1080",
    '🇭🇰 HK ISP-1 = socks5, other.example.com, 1080, underlying-proxy="🇭🇰 HK-ISP-1"',
    "🇭🇰 HK ISP-1 (2) = direct",
  ] });
  const rendered = subscriptionNodes(nodes);
  assert.equal(rendered[0].name, "🇭🇰 HK ISP-1 (3)");
  assert.match(rendered[1].value, /underlying-proxy="🇭🇰 HK ISP-1 \(3\)"/);
  assert.deepEqual(subscriptionNodes([...nodes].reverse()).reverse(), rendered);
  assert.deepEqual(subscriptionNodes(rendered), rendered);
});

test("parses grouped node object config", () => {
  const nodes = parseNodesConfig({
    group: "🇺🇸 US",
    value: [
      "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
      "US-02 = trojan, us-2.example.com, 443, password=secret, sni=us-2.example.com",
    ],
  });

  assert.deepEqual(nodes.map((node) => node.name), ["US-01", "US-02"]);
  assert.deepEqual(nodes.map((node) => node.group), ["🇺🇸 US", "🇺🇸 US"]);
});

test("parses grouped node array config", () => {
  const nodes = parseNodesConfig(
    [
      {
        group: "🇺🇸 US",
        value: [
          "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
        ],
      },
      {
        group: "🇯🇵 JP",
        value: [
          "JP-01 = vmess, jp.example.com, 443, username=00000000-0000-4000-8000-000000000000",
        ],
      },
    ],
  );

  assert.deepEqual(nodes.map((node) => node.name), ["US-01", "JP-01"]);
  assert.deepEqual(nodes.map((node) => node.group), ["🇺🇸 US", "🇯🇵 JP"]);
  assert.equal(
    renderProxyLines(nodes),
    [
      "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
      "JP-01 = vmess, jp.example.com, 443, username=00000000-0000-4000-8000-000000000000",
    ].join("\n"),
  );
});

test("parses legacy KV node config", () => {
  const nodes = parseNodesConfig(
    [
      {
        group: "🇺🇸 US",
        line: "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
      },
      {
        group: "🇯🇵 JP",
        line: "JP-01 = vmess, jp.example.com, 443, username=00000000-0000-4000-8000-000000000000",
      },
    ],
  );

  assert.deepEqual(nodes.map((node) => node.name), ["US-01", "JP-01"]);
  assert.deepEqual(nodes.map((node) => node.group), ["🇺🇸 US", "🇯🇵 JP"]);
  assert.equal(
    renderProxyLines(nodes),
    [
      "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
      "JP-01 = vmess, jp.example.com, 443, username=00000000-0000-4000-8000-000000000000",
    ].join("\n"),
  );
});

test("serializes node config by group", () => {
  const nodes = parseNodesConfig({
    group: "🇺🇸 US",
    value: [
      "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
      "US-02 = trojan, us-2.example.com, 443, password=secret, sni=us-2.example.com",
    ],
  });

  assert.deepEqual(serializeNodesConfig(nodes), {
    group: "🇺🇸 US",
    value: [
      "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
      "US-02 = trojan, us-2.example.com, 443, password=secret, sni=us-2.example.com",
    ],
  });
});

test("parses legacy name/value node config", () => {
  const nodes = parseNodesConfig([
    {
      name: "US-01",
      group: "🇺🇸 US",
      value: "trojan, us.example.com, 443, password=secret, sni=us.example.com",
    },
  ]);

  assert.equal(nodes[0].name, "US-01");
  assert.equal(nodes[0].line, "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com");
});

test("rejects empty node config", () => {
  assert.throws(() => parseNodesConfig([]), /at least one node/);
});

test("rejects comma in node groups", () => {
  assert.throws(
    () => parseNodesConfig([{ name: "US-01", group: "bad,group", value: "trojan, us.example.com, 443" }]),
    /Node group cannot contain a comma/,
  );
});

test("rejects malformed node line", () => {
  assert.throws(
    () => parseNodesConfig([{ group: "🇺🇸 US", line: "US-01 trojan, us.example.com, 443" }]),
    /line must use "name = value"/,
  );
});

test("rejects ambiguous node config", () => {
  assert.throws(
    () => parseNodesConfig([{ name: "US-01", group: "🇺🇸 US", value: "trojan, us.example.com, 443", line: "US-01 = trojan, us.example.com, 443" }]),
    /either line or name\/value/,
  );
});

test("rejects duplicate node names", () => {
  assert.throws(
    () =>
      parseNodesConfig(
        [
          { group: "🇺🇸 US", line: "US-01 = trojan, us-1.example.com, 443" },
          { group: "🇺🇸 US", line: "US-01 = trojan, us-2.example.com, 443" },
        ],
      ),
    /Duplicate node name/,
  );
});
