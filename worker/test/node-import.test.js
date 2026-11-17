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
function vless(overrides = {}, name = "🇭🇰 HongKong-ISP-1", host = "node.example.com:8443") {
  const query = new URLSearchParams({ type: "tcp", security: "reality", encryption: "none", flow: "xtls-rprx-vision",
    sni: "target.example.com", pbk: Buffer.alloc(32, 1).toString("base64url"), sid: "0123456789abcdef",
    fp: "chrome", spx: "/", ...overrides });
  return `vless://${UUID}@${host}?${query}#${encodeURIComponent(name)}`;
}
function unreachable() { assert.fail("must not fetch"); }

test("converts REALITY Vision links and mixed Base64 subscriptions with both protocols", async () => {
  const result = await importPoolNodes({ text: URL, nodes: [] }, async () => new Response(Buffer.from([
    vmess({ ps: "🇭🇰 HK-ISP-1" }), vless(),
  ].join("\n")).toString("base64")));
  assert.equal(result.added, 2);
  assert.equal(result.nodes[1].line, `🇭🇰 HongKong-ISP-1 = vless, node.example.com, 8443, username=${UUID}, flow=xtls-rprx-vision, sni=target.example.com, reality-public-key=${Buffer.alloc(32, 1).toString("base64url")}, reality-short-id=0123456789abcdef`);
  assert.ok(result.warnings.some((warning) => warning.includes("iOS 6.0.0+ / Mac 6.12.0+")));
  assert.doesNotMatch(result.nodes[1].line, /fp=|spx=/);
  assert.deepEqual(parsePoolNodes(result.nodes).map((node) => node.group), ["🇭🇰HK-ISP", "🇭🇰HK-ISP"]);
  const repeated = await importPoolNodes({ text: vless({ type: "raw" }), nodes: result.nodes }, unreachable);
  assert.equal(repeated.added, 0);
  assert.equal(repeated.duplicates, 1);
  assert.deepEqual(repeated.nodes, result.nodes);
});

test("3x-ui Hy2 links preserve TLS, credentials and names in direct and subscription imports", async () => {
  const name = "🇭🇰 HK-Hy2-ISP-1";
  const uri = `hysteria2://test%2Cuser:pass%23word@[2001:db8::1]/?security=tls&alpn=h3&sni=target.example.com&insecure=0#${encodeURIComponent(name)}`;
  const read = async () => new Response(Buffer.from([vmess(), vless(), uri].join("\n")).toString("base64"));
  const batch = await importPoolNodes({ text: "ISP-1\t" + URL, nodes: [] }, read);
  assert.equal(batch.added, 3);
  assert.equal(batch.nodes[2].line, `${name} = hysteria2, [2001:db8::1], 443, password="test,user:pass#word", sni=target.example.com, alpn=h3`);
  const again = await importPoolNodes({ text: "Other = " + uri.replace("hysteria2:", "hy2:"), nodes: batch.nodes }, unreachable);
  assert.equal(again.duplicates, 1);
  assert.deepEqual(again.nodes, batch.nodes);
  for (const value of ["?insecure=1&insecure=0", "?pinSHA256=bad", "?ech=unsupported", "?security=none", "?obfs=gecko"]) {
    await assert.rejects(importPoolNodes({ text: "hy2://TEST_ONLY@node.example.com" + value, nodes: [] }, unreachable),
      (error) => error.status === 400 && !error.message.includes("TEST_ONLY"));
  }
});

test("VLESS imports support explicit names, IPv6, empty short IDs and quoted ALPN", async () => {
  const result = await importPoolNodes({
    text: `🇭🇰 HK-IDC-1 = ${vless({ sid: "", alpn: "h2,http/1.1" }, "bad,name", "[2001:db8::1]:8443")}`, nodes: [],
  }, unreachable);
  assert.match(result.nodes[0].line, /^🇭🇰 HK-IDC-1 = vless, \[2001:db8::1\], 8443,/);
  assert.match(result.nodes[0].line, /reality-short-id=, alpn="h2,http\/1.1"$/);
});

test("3x-ui REALITY key exchange hints preserve the Surge node and its identity", async () => {
  const original = await importPoolNodes({ text: vless(), nodes: [] }, unreachable);
  for (const hint of ["true", "false"]) {
    const text = vless({ "support-x25519mlkem768": hint, spx: "/test-path" });
    const imported = await importPoolNodes({ text, nodes: [] }, unreachable);
    assert.equal(imported.nodes[0].line, original.nodes[0].line);
    assert.equal(imported.warnings.some((warning) => warning.includes("X25519MLKEM768")), hint === "false");
    const repeated = await importPoolNodes({ text, nodes: original.nodes }, unreachable);
    assert.equal(repeated.duplicates, 1);
    assert.deepEqual(repeated.nodes, original.nodes);
  }
});

test("rejects invalid or unsupported VLESS parameters without echoing connection credentials", async () => {
  for (const text of [
    vless({ type: "ws" }), vless({ type: "grpc" }), vless({ security: "tls" }), vless({ flow: "" }),
    vless({ encryption: "PRIVATE_TEST_ONLY" }), vless({ headerType: "http" }), vless({ extra: "PRIVATE_TEST_ONLY" }),
    vless({ pbk: "PRIVATE_TEST_ONLY" }), vless({ sid: "abc" }), vless({ sid: "000000000000000000" }),
    vless({ sni: "target.example.com\n[Rule]" }), vless({ alpn: "h2,,http/1.1" }),
    vless({ "support-x25519mlkem768": "PRIVATE_TEST_ONLY" }), vless({ "support-x25519mlkem768": "" }),
    vless({ "support-x25519mlkem768": "true" }).replace("?", "?support-x25519mlkem768=false&"),
    vless().replace(UUID, "PRIVATE_TEST_ONLY"), vless().replace(":8443", ":0"),
    vless().replace(":8443", ":70000"), vless().replace("?", "?security=reality&"),
    vless().replace("@", ":PRIVATE_TEST_ONLY@"), vless().replace("?", "/path?"),
  ]) {
    await assert.rejects(importPoolNodes({ text, nodes: [] }, unreachable), (error) =>
      error.status === 400 && !error.message.includes("PRIVATE_TEST_ONLY") && !error.message.includes(UUID));
  }
});

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

test("imports 3x-ui export rows with the original names of every upstream node", async () => {
  const idc = URL + "/idc?format=raw&next=https://example.com/help";
  const isp = URL + "/isp-1";
  const warp = URL + "/warp";
  const subscriptions = new Map([
    [idc, native("🇺🇸 Example-IDC")],
    [isp, Buffer.from([vmess({ ps: "🇭🇰 HK-ISP-1", port: 8443 }), vless({ "support-x25519mlkem768": "true" })].join("\n")).toString("base64")],
    [warp, "🇺🇸 Example-WARP = trojan, warp.example.com, 443, password=TEST_ONLY"],
  ]);
  const text = [`IDC\t${idc}`, `ISP-1   ${isp}`, `Warp\t${warp}`, "", `Another label\t${isp}`].join("\r\n");
  const calls = [];
  const result = await importPoolNodes({ text, nodes: [] }, async (url) => {
    calls.push(url);
    return new Response(subscriptions.get(url));
  });
  assert.deepEqual(calls, [idc, isp, warp]);
  assert.equal(result.added, 4);
  assert.equal(result.duplicates, 2);
  assert.deepEqual(parsePoolNodes(result.nodes).map((node) => node.name),
    ["🇺🇸 Example-IDC", "🇭🇰 HK-ISP-1", "🇭🇰 HongKong-ISP-1", "🇺🇸 Example-WARP"]);
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

const ACCESS = {
  NODE_IMPORT_ACCESS_ORIGIN: "https://subscription.example.com:2096",
  NODE_IMPORT_ACCESS_CLIENT_ID: "TEST_ONLY_CLIENT_ID.access",
  NODE_IMPORT_ACCESS_CLIENT_SECRET: "TEST_ONLY_CLIENT_SECRET",
};

test("sends Access credentials only to the configured exact HTTPS origin", async () => {
  const urls = [URL, "https://SUBSCRIPTION.EXAMPLE.COM:2096/second",
    "https://subscription.example.com/other-port", "https://subscription.example.com.attacker.example/node",
    "https://other.example.com:2096/node", "https://subscription.example.com.:2096/node"];
  const seen = [];
  const result = await importPoolNodes({ text: urls.join("\n"), nodes: [] }, async (url, options) => {
    seen.push(url);
    const trusted = seen.length <= 2;
    assert.equal(options.headers["CF-Access-Client-Id"], trusted ? ACCESS.NODE_IMPORT_ACCESS_CLIENT_ID : undefined);
    assert.equal(options.headers["CF-Access-Client-Secret"], trusted ? ACCESS.NODE_IMPORT_ACCESS_CLIENT_SECRET : undefined);
    assert.equal(options.redirect, "manual");
    return new Response(vmess());
  }, ACCESS);
  assert.equal(seen.length, urls.length);
  assert.equal(result.added, 1);
  assert.equal(result.duplicates, urls.length - 1);
  assert.doesNotMatch(JSON.stringify(result), /TEST_ONLY_CLIENT/);
});

test("does not follow protected upstream redirects or expose credentials on failure", async () => {
  for (const status of [302, 401, 403]) {
    let calls = 0;
    await assert.rejects(importPoolNodes({ text: URL, nodes: [] }, async (_url, options) => {
      calls += 1;
      assert.equal(options.headers["CF-Access-Client-Secret"], ACCESS.NODE_IMPORT_ACCESS_CLIENT_SECRET);
      return new Response(ACCESS.NODE_IMPORT_ACCESS_CLIENT_SECRET, { status,
        headers: { location: "https://other.example.com/node" } });
    }, ACCESS), (error) => error.status === 400 && !error.message.includes("TEST_ONLY_CLIENT"));
    assert.equal(calls, 1);
  }
});

test("selects separate upstream credentials while preserving the existing Access origin", async () => {
  const second = { origin: "https://second.example.com", clientId: "TEST_SECOND_ID", clientSecret: "TEST_SECOND_SECRET" };
  const env = { ...ACCESS, NODE_IMPORT_ACCESS_UPSTREAMS: JSON.stringify([second]) };
  const urls = [URL, "https://SECOND.EXAMPLE.COM/sub", "https://second.example.com:2096/sub",
    "https://second.example.com.attacker.example/sub", "https://second.example.com./sub"];
  const seen = [];
  const result = await importPoolNodes({ text: urls.join("\n"), nodes: [] }, async (url, options) => {
    const origin = new globalThis.URL(url).origin;
    const expected = origin === ACCESS.NODE_IMPORT_ACCESS_ORIGIN
      ? [ACCESS.NODE_IMPORT_ACCESS_CLIENT_ID, ACCESS.NODE_IMPORT_ACCESS_CLIENT_SECRET]
      : origin === second.origin ? [second.clientId, second.clientSecret] : [undefined, undefined];
    assert.deepEqual([options.headers["CF-Access-Client-Id"], options.headers["CF-Access-Client-Secret"]], expected);
    assert.equal(options.redirect, "manual");
    seen.push(origin);
    return new Response(vmess());
  }, env);
  assert.equal(seen.length, urls.length);
  assert.equal(result.added, 1);
  assert.doesNotMatch(JSON.stringify(result), /TEST_(?:ONLY|SECOND)/);
});

test("supports an upstream map without legacy credentials and blocks its redirects", async () => {
  const env = { NODE_IMPORT_ACCESS_UPSTREAMS: JSON.stringify([
    { origin: ACCESS.NODE_IMPORT_ACCESS_ORIGIN, clientId: ACCESS.NODE_IMPORT_ACCESS_CLIENT_ID,
      clientSecret: ACCESS.NODE_IMPORT_ACCESS_CLIENT_SECRET },
  ]) };
  let calls = 0;
  await assert.rejects(importPoolNodes({ text: URL, nodes: [] }, async (_url, options) => {
    calls += 1;
    assert.equal(options.headers["CF-Access-Client-Secret"], ACCESS.NODE_IMPORT_ACCESS_CLIENT_SECRET);
    assert.equal(options.redirect, "manual");
    return new Response("TEST_ONLY_CLIENT_SECRET", { status: 302, headers: { location: "https://other.example.com/sub" } });
  }, env), (error) => error.status === 400 && !error.message.includes("TEST_ONLY_CLIENT"));
  assert.equal(calls, 1);
});

test("rejects malformed, incomplete and duplicate upstream credentials before any fetch", async () => {
  const entry = { origin: ACCESS.NODE_IMPORT_ACCESS_ORIGIN, clientId: "TEST_ID", clientSecret: "TEST_SECRET" };
  const invalid = ["not-json", "null", "{}", JSON.stringify([null]), JSON.stringify([{}]),
    JSON.stringify([{ ...entry, origin: "http://second.example.com" }]),
    JSON.stringify([{ ...entry, origin: "https://second.example.com/path" }]),
    JSON.stringify([{ ...entry, origin: "https://127.0.0.1" }]),
    JSON.stringify([{ ...entry, clientSecret: "TEST_SECRET\r\nX-Injected: yes" }]),
    JSON.stringify([entry, { ...entry, origin: "https://SUBSCRIPTION.EXAMPLE.COM:2096/" }])];
  for (const value of invalid) {
    await assert.rejects(importPoolNodes({ text: URL, nodes: [] }, unreachable,
      { NODE_IMPORT_ACCESS_UPSTREAMS: value }), (error) => error.status === 503 && !error.message.includes("TEST_SECRET"));
  }
  await assert.rejects(importPoolNodes({ text: URL, nodes: [] }, unreachable,
    { ...ACCESS, NODE_IMPORT_ACCESS_UPSTREAMS: JSON.stringify([entry]) }), (error) => error.status === 503);
});

test("fails closed on incomplete or unsafe Access configuration before fetching", async () => {
  const invalid = [
    { ...ACCESS, NODE_IMPORT_ACCESS_CLIENT_SECRET: undefined },
    { ...ACCESS, NODE_IMPORT_ACCESS_CLIENT_ID: "" },
    { ...ACCESS, NODE_IMPORT_ACCESS_ORIGIN: undefined },
    { ...ACCESS, NODE_IMPORT_ACCESS_CLIENT_SECRET: "TEST_ONLY_CLIENT_SECRET\r\nX-Injected: yes" },
    ...["http://subscription.example.com", "https://127.0.0.1", "https://router.internal",
      "https://user:TEST_ONLY_CLIENT_SECRET@subscription.example.com", "https://subscription.example.com/path",
      "https://subscription.example.com?token=TEST_ONLY_CLIENT_SECRET", "https://subscription.example.com#fragment"]
      .map((origin) => ({ ...ACCESS, NODE_IMPORT_ACCESS_ORIGIN: origin })),
  ];
  for (const env of invalid) {
    await assert.rejects(importPoolNodes({ text: URL, nodes: [] }, unreachable, env), (error) =>
      error.status === 503 && !error.message.includes("TEST_ONLY_CLIENT"));
  }
  // Direct node input does not need an upstream service or its credentials.
  assert.equal((await importPoolNodes({ text: vmess(), nodes: [] }, unreachable, invalid[0])).added, 1);
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

test("an upstream VMess protocol tag renames only the exact legacy name and connection in the draft", async () => {
  const oldName = "🇭🇰 HK-ISP-1";
  const name = "🇭🇰 HK-VMess-ISP-1";
  const existing = { id: "existing", enabled: false, line: native(oldName) };
  const result = await importPoolNodes({ text: URL, nodes: [existing] }, async () => new Response(vmess({ ps: name })));
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.nodes, [{ ...existing, line: existing.line.replace(oldName, name) }]);
  assert.equal(existing.line, native(oldName));
  const custom = { ...existing, line: native("🇭🇰 Custom-ISP-1") };
  const repeated = await importPoolNodes({ text: vmess({ ps: name }), nodes: [custom] }, unreachable);
  assert.deepEqual(repeated.nodes, [custom]);
});

test("mixed subscriptions free the old VMess name and preserve custom exit countries for matching clients", async () => {
  const client = "ISP-TEST";
  const vmName = "🇭🇰 HK-VMess-" + client;
  const vlName = "🇭🇰 HongKong-" + client;
  const hyName = "🇭🇰 HK-Hy2-" + client;
  const shares = [vless({}, vlName), "hy2://TEST_ONLY@node.example.com#" + encodeURIComponent(hyName), vmess({ ps: vmName })];
  const read = async () => new Response(shares.join("\n"));
  for (const [oldName, flag, expectedVm] of [[vlName, "🇭🇰", vmName], ["🇦🇺 Custom-ISP-9", "🇦🇺", "🇦🇺 Custom-ISP-9"]]) {
    const original = { id: "keeper", line: native(oldName), enabled: true };
    const result = await importPoolNodes({ text: URL, nodes: [original] }, read);
    const parsed = parsePoolNodes(result.nodes);
    assert.equal(result.added, 2);
    assert.equal(result.duplicates, 1);
    assert.deepEqual(parsed.map((node) => node.name), [expectedVm, vlName.replace("🇭🇰", flag), hyName.replace("🇭🇰", flag)]);
    assert.equal(parsed[0].id, original.id);
    assert.equal(original.line, native(oldName));
    const again = await importPoolNodes({ text: URL, nodes: result.nodes }, read);
    assert.deepEqual(again.nodes, result.nodes);
  }
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
  }), /支持 HTTPS 订阅/);
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
