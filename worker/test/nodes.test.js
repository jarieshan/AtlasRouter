import assert from "node:assert/strict";
import test from "node:test";

import { excludeVless, parseNodesConfig, renderProxyLines, resolveNodeHosts, serializeNodesConfig, subscriptionNodes } from "../src/nodes.js";

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

test("excluding VLESS keeps the remaining fallback order and omits groups left empty", () => {
  const nodes = parseNodesConfig([
    { group: "🇭🇰HK-ISP", value: ["A-VLESS = VLESS, a.example.com, 8443, username=TEST_ONLY", "A-VMess = vmess, a.example.com, 443, username=TEST_ONLY",
      "B-VLESS = vless, b.example.com, 8443, username=TEST_ONLY", "B-Hy2 = hysteria2, b.example.com, 443, password=TEST_ONLY"] },
    { group: "🇺🇸USA-ISP", value: ["C-VLESS = vless, c.example.com, 8443, username=TEST_ONLY"] },
  ]);
  const groups = [{ group: "🇭🇰HK-ISP", primaryId: "a", nodes: nodes.slice(0, 4) }, { group: "🇺🇸USA-ISP", primaryId: "c", nodes: nodes.slice(4) }];
  const before = structuredClone(groups);
  assert.deepEqual(excludeVless(groups), [{ group: "🇭🇰HK-ISP", primaryId: "a", nodes: [nodes[1], nodes[3]] }]);
  assert.deepEqual(groups, before);
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

test("node hostnames resolve once over DoH with a fallback resolver and unresolved hosts are left out", async () => {
  const nodes = parseNodesConfig({ group: "test", value: [
    "HK-1 = trojan, HK-1.example.com, 443, password=TEST_ONLY",
    "HK-2 = trojan, hk-1.example.com, 8443, password=TEST_ONLY",
    "US-1 = vmess, us-1.example.com, 443, username=TEST_ONLY",
    "DOWN-1 = trojan, down.example.com, 443, password=TEST_ONLY",
    "IP-1 = trojan, 192.0.2.9, 443, password=TEST_ONLY",
    "DIRECT-1 = direct",
  ] });
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push(url);
    assert.equal(init.headers.accept, "application/dns-json");
    const { hostname, searchParams } = new URL(url);
    const name = searchParams.get("name");
    if (name === "hk-1.example.com") {
      return Response.json({ Answer: [{ type: 5, data: "edge.example.net." }, { type: 1, data: "192.0.2.1" }, { type: 1, data: "192.0.2.1" }] });
    }
    if (name === "us-1.example.com" && hostname === "cloudflare-dns.com") return new Response("unavailable", { status: 503 });
    if (name === "us-1.example.com") return Response.json({ Answer: [{ type: 1, data: "192.0.2.2" }, { type: 1, data: "192.0.2.3" }] });
    throw new Error("network down");
  };
  assert.deepEqual([...await resolveNodeHosts(nodes, fetcher)], [["hk-1.example.com", ["192.0.2.1"]], ["us-1.example.com", ["192.0.2.2", "192.0.2.3"]]]);
  assert.deepEqual(requests.filter((url) => url.includes("hk-1.example.com")), ["https://cloudflare-dns.com/dns-query?name=hk-1.example.com&type=A"]);
  assert.deepEqual(requests.filter((url) => url.includes("us-1.example.com")).map((url) => new URL(url).hostname), ["cloudflare-dns.com", "dns.google"]);
  assert.equal(requests.filter((url) => url.includes("down.example.com")).length, 2);
  assert.ok(!requests.some((url) => url.includes("192.0.2.9")));
});
