import assert from "node:assert/strict";
import test from "node:test";
import { resetPoolNodes, importPoolNodes } from "../src/node-import.js";
import { parsePoolNodes } from "../src/node-pool.js";

const UUID = "00000000-0000-4000-8000-000000000001";
const URL = "https://subscription.example.com:2096/test-only/node";
function vmess(overrides = {}, encoding = "base64") {
  return "vmess://" + Buffer.from(JSON.stringify({
    v: "2", ps: "🇺🇸 Example - ISP 1", add: "node.example.com", port: "443", id: UUID,
    scy: "auto", net: "tcp", type: "none", tls: "tls", sni: "node.example.com",
    ...overrides,
  })).toString(encoding);
}
function native(name = "🇺🇸 Existing - ISP 1", extras = "") {
  return `${name} = vmess, node.example.com, 443, username=${UUID}, tls=true, vmess-aead=true${extras}`;
}
function unreachable() { assert.fail("must not fetch"); }

test("resetting keeps every production definition in order with fresh identities and no source history", () => {
  const source = [
    { id: "production-id", line: native("🇺🇸 Production - ISP"), enabled: true },
    { id: "production-alias", line: native("🇺🇸 Alias - ISP"), enabled: false,
      ownerIds: ["production-user"], assignmentCount: 99 },
    { line: "🇭🇰 Third - IDC = trojan, third.example.com, 443, password=TEST_ONLY", enabled: true },
  ];
  const before = structuredClone(source);
  const reset = resetPoolNodes(source);
  const definitions = (nodes) => nodes.map(({ line, enabled }) => ({ line, enabled }));
  assert.deepEqual(definitions(reset), definitions(source));
  assert.ok(reset.every((node) => !source.some((item) => item.id === node.id)));
  assert.ok(reset.every((node) => Object.keys(node).sort().join() === "enabled,id,line"));
  assert.equal(new Set(reset.map((node) => node.id)).size, 3);
  assert.deepEqual(source, before);
  const repeated = resetPoolNodes(source);
  assert.deepEqual(definitions(repeated), definitions(source));
  assert.ok(repeated.every((node) => !reset.some((item) => item.id === node.id)));
  assert.deepEqual(resetPoolNodes([]), []);
});

test("resetting refuses oversized production inventories", () => {
  const node = { line: "🇺🇸 ISP = trojan, node.example.com, 443, password=TEST_ONLY", enabled: true };
  assert.throws(() => resetPoolNodes(Array(1001).fill(node)), /1000/);
  const large = { ...node, line: node.line.replace("TEST_ONLY", "x".repeat(3500)) };
  assert.throws(() => resetPoolNodes(Array(160).fill(large)), /512 KiB/);
});

test("converts one Base64 subscription without persisting its URL or forwarding credentials", async () => {
  const link = vmess({ alpn: "h2,http/1.1", fp: "chrome" });
  const calls = [];
  const result = await importPoolNodes({ text: URL, nodes: [] }, async (url, options) => {
    calls.push(url);
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.deepEqual(Object.keys(options.headers).sort(), ["accept", "user-agent"]);
    return new Response(Buffer.from(link).toString("base64"));
  });
  assert.deepEqual(calls, [URL]);
  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 0);
  assert.equal(result.nodes[0].line, `🇺🇸 Example - ISP 1 = vmess, node.example.com, 443, username=${UUID}, encrypt-method=aes-128-gcm, vmess-aead=true, tls=true, sni=node.example.com, alpn="h2,http/1.1"`);
  assert.equal(parsePoolNodes(result.nodes)[0].group, "🇺🇸USA-ISP");
  assert.ok(result.warnings.some((warning) => warning.includes("ALPN")));
  assert.ok(result.warnings.some((warning) => warning.includes("浏览器指纹")));
  assert.ok(!JSON.stringify(result).includes(URL));
});

test("converts URL-safe UTF-8 VMess and WebSocket options while keeping native Surge lines", async () => {
  const link = vmess({
    ps: "🇭🇰 香港 - idc", aid: "0", net: "ws", path: "/ws?ed=2048", host: "cdn.example.com",
    sni: "tls.example.com", scy: "chacha20-poly1305", insecure: "1",
  }, "base64url");
  const raw = "🇸🇬 Example - WARP = trojan, sg.example.com, 443, password=TEST_ONLY";
  const result = await importPoolNodes({ text: `${link}\r\n${raw}`, nodes: [] }, unreachable);
  assert.equal(result.added, 2);
  assert.match(result.nodes[0].line, /encrypt-method=chacha20-ietf-poly1305/);
  assert.match(result.nodes[0].line, /sni=tls\.example\.com/);
  assert.match(result.nodes[0].line, /skip-cert-verify=true/);
  assert.match(result.nodes[0].line, /ws=true, ws-path=\/ws\?ed=2048, ws-headers=Host:cdn\.example\.com$/);
  assert.equal(result.nodes[1].line, raw);
  assert.deepEqual(parsePoolNodes(result.nodes).map((node) => node.group), ["🇭🇰HK-IDC", "🇸🇬SG-WARP"]);
  const noTls = await importPoolNodes({ text: vmess({ tls: "", sni: "", net: "ws" }), nodes: [] }, unreachable);
  assert.doesNotMatch(noTls.nodes[0].line, /tls=|sni=/);
  assert.match(noTls.nodes[0].line, /ws-path=\/$/);
});

test("deduplicates links, names, parameter order and VMess defaults without changing existing entries", async () => {
  const existing = { id: "keep-this-id", line: native(), enabled: false };
  const snapshot = structuredClone(existing);
  let calls = 0;
  const reordered = `🇺🇸 Renamed - ISP = VMESS, NODE.EXAMPLE.COM, 0443, vmess-aead=TRUE, tls=true, encrypt-method=aes-128-gcm, username=${UUID}, sni=node.example.com`;
  const result = await importPoolNodes({ text: [URL, URL, reordered, vmess()].join("\n"), nodes: [existing] }, async () => {
    calls += 1;
    return new Response(vmess());
  });
  assert.equal(calls, 1);
  assert.equal(result.duplicates, 4);
  assert.equal(result.added, 0);
  assert.deepEqual(result.nodes, [snapshot]);
  assert.deepEqual(existing, snapshot);
});

test("does not merge different credentials, TLS/AEAD options or quoted values on the same endpoint", async () => {
  const result = await importPoolNodes({ text: [
    vmess(), vmess({ id: "00000000-0000-4000-8000-000000000002" }),
    vmess({ tls: "", sni: "" }), native("🇺🇸 Legacy - ISP").replace("vmess-aead=true", "vmess-aead=false"),
    native("🇺🇸 ALPN - ISP", ', alpn="h2,http/1.1"'), native("🇺🇸 ALPN2 - ISP", ', alpn="http/1.1,h2"'),
  ].join("\n"), nodes: [] }, unreachable);
  assert.equal(result.added, 6);
  assert.equal(result.duplicates, 0);
  assert.match(result.nodes[1].line, /^🇺🇸 Example - ISP 1 \(2\) =/);
  assert.equal(parsePoolNodes(result.nodes).length, 6);
  const quoted = '🇺🇸 Password - ISP = trojan, node.example.com, 443, password="TEST,ONLY=1"';
  const changed = quoted.replace('TEST,ONLY=1', 'TEST,ONLY=2').replace('Password', 'Changed');
  const commas = await importPoolNodes({ text: [quoted, quoted.replace('Password', 'Renamed'), changed].join("\n"), nodes: [] }, unreachable);
  assert.equal(commas.added, 2);
  assert.equal(commas.duplicates, 1);
});

test("preserves keyword classification and allows explicit names without guessing missing types", async () => {
  const source = vmess({ ps: "🇺🇸 Example" });
  const draft = await importPoolNodes({ text: source, nodes: [] }, unreachable);
  assert.match(draft.nodes[0].line, /^🇺🇸 Example =/);
  assert.ok(draft.warnings.some((warning) => warning.includes("IDC / ISP / WARP")));
  assert.throws(() => parsePoolNodes(draft.nodes));
  const named = await importPoolNodes({ text: `🇺🇸 Custom - ISP = ${URL}`, nodes: [] }, async () => new Response(source));
  assert.equal(parsePoolNodes(named.nodes)[0].group, "🇺🇸USA-ISP");
  assert.equal(named.warnings.length, 0);
  const invalidSourceName = await importPoolNodes({ text: `🇺🇸 Custom - ISP = ${vmess({ ps: "bad,name" })}`, nodes: [] }, unreachable);
  assert.equal(parsePoolNodes(invalidSourceName.nodes).length, 1);
});

test("imports only the Proxy section of a Surge response and handles multiline subscriptions", async () => {
  const surge = `[General]\nloglevel=notify\n[Proxy]\n# comment\n${native()}\n[Proxy Group]\nGroup = select, DIRECT\n[Rule]\nFINAL,DIRECT`;
  const result = await importPoolNodes({ text: URL, nodes: [] }, async () => new Response(surge));
  assert.equal(result.added, 1);
  assert.equal(result.nodes[0].line, native());
  const multiple = await importPoolNodes({ text: URL, nodes: [] }, async () => new Response(Buffer.from(`${vmess()}\n${vmess()}\n`).toString("base64url")));
  assert.equal(multiple.added, 1);
  assert.equal(multiple.duplicates, 1);
});

test("rejects unsupported or malformed VMess without returning input credentials", async () => {
  const invalidLinks = [
    "vmess://not-valid!", "vmess://" + Buffer.from("not-json").toString("base64"),
    vmess({ net: "grpc" }), vmess({ type: "http" }), vmess({ tls: "reality" }),
    vmess({ aid: 4 }), vmess({ aid: false }), vmess({ scy: "none" }), vmess({ scy: "constructor" }),
    vmess({ id: "PRIVATE_TEST_ONLY" }), vmess({ port: 70000 }), vmess({ port: true }),
    vmess({ add: "node.example.com\n[Rule]" }), vmess({ net: "ws", path: "not-absolute" }),
    vmess({ net: "ws", path: '/bad"path' }), vmess({ extra: "PRIVATE_TEST_ONLY" }),
  ];
  for (const text of invalidLinks) {
    await assert.rejects(importPoolNodes({ text, nodes: [] }, unreachable), (error) => {
      assert.equal(error.status, 400);
      assert.ok(!error.message.includes(text));
      assert.doesNotMatch(error.message, /PRIVATE_TEST_ONLY/);
      return true;
    });
  }
});

test("rejects non-public URLs and recursive subscription URLs without making requests", async () => {
  for (const text of [
    "https://localhost/node", "https://router.local/node", "https://metadata.internal/node",
    "https://127.0.0.1/node", "https://10.0.0.1/node", "https://2130706433/node", "https://[::1]/node",
    "https://user:PRIVATE_TEST_ONLY@subscription.example.com/node", "http://subscription.example.com/node",
    "file:///etc/passwd", "vless://PRIVATE_TEST_ONLY@node.example.com:443",
  ]) await assert.rejects(importPoolNodes({ text, nodes: [] }, unreachable), (error) => error.status === 400 && !error.message.includes("PRIVATE_TEST_ONLY"));
  let calls = 0;
  await assert.rejects(importPoolNodes({ text: URL, nodes: [] }, async () => {
    calls += 1;
    return new Response("https://another.example.com/PRIVATE_TEST_ONLY");
  }), /仅支持/);
  assert.equal(calls, 1);
});

test("bounds downloads, rejects redirects and redacts network errors", async () => {
  for (const response of [
    () => new Response("PRIVATE_TEST_ONLY", { status: 401 }),
    () => new Response('<html lang="en">PRIVATE_TEST_ONLY</html>'),
    () => new Response("", { status: 302, headers: { location: "https://localhost/PRIVATE_TEST_ONLY" } }),
    () => new Response("x".repeat(512 * 1024 + 1)),
  ]) await assert.rejects(importPoolNodes({ text: URL, nodes: [] }, async () => response()), (error) => error.status === 400 && !error.message.includes("PRIVATE_TEST_ONLY"));
  await assert.rejects(importPoolNodes({ text: URL, nodes: [] }, async () => { throw new Error(URL); }), (error) => error.status === 400 && !error.message.includes(URL));
  await assert.rejects(importPoolNodes({ text: Array.from({ length: 21 }, (_, index) => `https://subscription.example.com/${index}`).join("\n"), nodes: [] }, unreachable), /20/);
  await assert.rejects(importPoolNodes({ text: "x".repeat(512 * 1024 + 1), nodes: [] }, unreachable), /导入文本/);
});

test("does not create a converted draft too large for the inventory save endpoint", async () => {
  const text = Array.from({ length: 134 }, (_, index) => `🇺🇸 Bulk - ISP ${index} = trojan, node-${index}.example.com, 443, password=${"x".repeat(3800)}`).join("\n");
  assert.ok(new TextEncoder().encode(text).length < 512 * 1024);
  await assert.rejects(importPoolNodes({ text: URL, nodes: [] }, async () => new Response(text)), /转换后的清单超过/);
});

test("aborts a stalled subscription and leaves the input inventory untouched", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const existing = [{ id: "keep", line: native(), enabled: false }];
  const before = structuredClone(existing);
  const promise = importPoolNodes({ text: URL, nodes: existing }, async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const rejected = assert.rejects(promise, /超时/);
  t.mock.timers.tick(10_001);
  await rejected;
  assert.deepEqual(existing, before);
});
