import assert from "node:assert/strict";
import test from "node:test";
import { allocateNodes, parsePoolNodes, userGroups } from "../src/node-pool.js";
import { renderSurgeProfile } from "../src/render-surge.js";
import { convertSurgeToClash } from "../src/render-clash.js";
import { splitSurgeList, surgeAssignment, surgeOptions, surgeSections } from "../src/surge-format.js";
import { createTailnetNodes } from "../src/tailnet-nodes.js";

const endpoint = { server: "hk.example.com", port: 443, hostname: "node.example-tailnet.ts.net" };
const tailnetEndpoints = JSON.stringify([endpoint]);
const context = { requestUrl: "https://atlas.example/AtlasRouter", token: "test-token" };
const value = 'vmess, hk.example.com, 443, username=11111111-2222-4333-8444-555555555555, vmess-aead=true, tls=true, sni=hk.example.com, alpn="h2,http/1.1"';

function fixture() {
  const state = { users: [{ id: "user", enabled: true }], nodes: parsePoolNodes([
    { id: "hk-idc", line: `🇭🇰 HK IDC (1) = ${value}` },
    { id: "hk-isp", line: `🇭🇰 HK ISP = ${value}` },
    { id: "us", line: "🇺🇸 US IDC = trojan, us.example.com, 443, password=TEST_ONLY" },
  ]) };
  allocateNodes(state, "2026-01-01T00:00:00Z");
  const groups = userGroups(state, "user");
  return { ...context, groups, nodes: groups.flatMap((group) => group.nodes) };
}

function privateFixture() {
  const input = fixture();
  const us = input.nodes.find((node) => node.id === "us");
  us.value = value.replaceAll("hk.example.com", "us.example.com");
  us.line = `${us.name} = ${us.value}`;
  return { ...input, tailnetOnly: true, tailnetEndpoints: JSON.stringify([
    endpoint, { ...endpoint, server: "us.example.com", hostname: "us.example-tailnet.ts.net" },
  ]) };
}

test("Tailnet-only subscriptions replace every server without changing names, allocations or groups", () => {
  const input = privateFixture();
  const before = structuredClone(input);
  const baseline = surgeSections(renderSurgeProfile({ ...input, tailnetOnly: false, tailnetEndpoints: undefined }));
  const profile = renderSurgeProfile(input);
  const sections = surgeSections(profile);
  assert.deepEqual(input, before);
  assert.deepEqual(sections.get("proxy group"), baseline.get("proxy group"));
  assert.doesNotMatch(profile, /Tailnet Test|hk\.example\.com|us\.example\.com/);
  const proxies = new Map(sections.get("proxy").map(surgeAssignment));
  assert.equal(proxies.size, input.nodes.length + 1);
  for (const original of input.nodes) {
    const [protocol, host, port, ...params] = splitSurgeList(proxies.get(original.name));
    const expectedHost = original.id === "us" ? "us.example-tailnet.ts.net" : endpoint.hostname;
    assert.deepEqual([protocol, host, port], ["vmess", expectedHost, "443"]);
    const expected = surgeOptions(splitSurgeList(original.value).slice(3));
    expected.set("sni", expectedHost);
    expected.set("skip-cert-verify", "false");
    expected.set("underlying-proxy", "Tailnet");
    assert.deepEqual(surgeOptions(params), expected);
  }
  for (const host of ["controlplane.tailscale.com", "login.tailscale.com"]) {
    assert.ok(sections.get("rule").includes(`DOMAIN,${host},DIRECT`));
    assert.ok(sections.get("host").includes(`${host} = server:223.5.5.5, 119.29.29.29`));
  }
  assert.equal(sections.get("rule").at(-1), "FINAL,FINAL,dns-failed");
});

test("Tailnet-only Clash chains all nodes and keeps bootstrap DNS independent when DoH is enabled", async () => {
  const input = { ...privateFixture(), options: { doh: true } };
  const baseline = await convertSurgeToClash(renderSurgeProfile({ ...input, tailnetOnly: false, tailnetEndpoints: undefined }), context);
  const { config } = await convertSurgeToClash(renderSurgeProfile(input), context);
  assert.deepEqual(config["proxy-groups"], baseline.config["proxy-groups"]);
  assert.equal(config.proxies.length, input.nodes.length + 1);
  for (const node of config.proxies.filter(({ name }) => name !== "Tailnet")) {
    const original = baseline.config.proxies.find(({ name }) => name === node.name);
    const hostname = original.server === "us.example.com" ? "us.example-tailnet.ts.net" : endpoint.hostname;
    assert.deepEqual(node, { ...original, server: hostname, servername: hostname, "skip-cert-verify": false, "dialer-proxy": "Tailnet" });
  }
  for (const host of ["controlplane.tailscale.com", "login.tailscale.com"]) {
    assert.ok(config.rules.includes(`DOMAIN,${host},DIRECT`));
    assert.deepEqual(config.dns["nameserver-policy"][host], ["223.5.5.5", "119.29.29.29"]);
  }
  assert.deepEqual(config.proxies.find(({ name }) => name === "Tailnet"), { name: "Tailnet", type: "tailscale", udp: true });
});

test("Tailnet-only mode rejects missing mappings and incompatible nodes instead of falling back to public servers", () => {
  const input = privateFixture();
  const safeError = (error) => error.status === 503 && !/11111111|hk\.example|us\.example|NEVER_LOG_THIS/.test(error.message);
  for (const config of [undefined, "", "[]", tailnetEndpoints, "NEVER_LOG_THIS",
    JSON.stringify([{ ...endpoint, port: 8443 }])]) {
    assert.throws(() => renderSurgeProfile({ ...input, tailnetEndpoints: config }), safeError);
  }
  for (const badValue of ['vmess, "NEVER_LOG_THIS', value.replace("tls=true", "tls=false"),
    value.replace("vmess,", "trojan,"), `${value}, ws=true`]) {
    assert.throws(() => createTailnetNodes([{ ...input.nodes[0], value: badValue }], tailnetEndpoints, { replace: true }), safeError);
  }
});

test("Tailnet variants preserve public nodes, credentials, quoted options and allocation", () => {
  const input = fixture();
  const before = structuredClone(input);
  const variants = createTailnetNodes(input.nodes, tailnetEndpoints);
  assert.equal(variants.length, 2);
  assert.deepEqual(input, before);
  for (const variant of variants) {
    const original = input.nodes.find((node) => node.id === variant.id);
    assert.equal(variant.name, `Tailnet Test - ${original.name}`);
    const [protocol, host, port, ...params] = splitSurgeList(variant.value);
    assert.deepEqual([protocol, host, port], ["vmess", endpoint.hostname, "443"]);
    const options = surgeOptions(params);
    const expected = surgeOptions(splitSurgeList(original.value).slice(3));
    expected.set("sni", endpoint.hostname);
    expected.set("skip-cert-verify", "false");
    expected.set("underlying-proxy", "Tailnet");
    assert.deepEqual(options, expected);
    assert.ok(variant.value.includes('alpn="h2,http/1.1"'));
  }
});

test("Tailnet testing is explicitly selectable and excluded from automatic and DoH groups", () => {
  const input = fixture();
  const before = surgeSections(renderSurgeProfile(input));
  const after = surgeSections(renderSurgeProfile({ ...input, tailnetEndpoints }));
  const groups = new Map(after.get("proxy group").map(surgeAssignment));
  const variants = createTailnetNodes(input.nodes, tailnetEndpoints);
  assert.equal(groups.get("Tailnet Test"), `select, ${variants.map((node) => node.name).join(", ")}`);
  const auto = surgeOptions(splitSurgeList(groups.get("Auto")).slice(1));
  const filter = new RegExp(auto.get("policy-regex-filter"));
  for (const node of input.nodes) assert.equal(filter.test(node.name), true);
  for (const name of ["Tailnet", ...variants.map((node) => node.name)]) assert.equal(filter.test(name), false);
  for (const line of before.get("proxy group")) {
    const [name, original] = surgeAssignment(line);
    const parts = splitSurgeList(original);
    const updated = splitSurgeList(groups.get(name));
    if (parts[0] === "select" && !["FINAL", "Speedtest"].includes(name)) {
      assert.equal(updated.filter((part) => part === "Tailnet Test").length, 1);
      assert.deepEqual(updated.filter((part) => part !== "Tailnet Test"), parts);
    } else if (name !== "Auto") assert.equal(groups.get(name), original);
  }
  for (const line of before.get("proxy")) assert.ok(after.get("proxy").includes(line));
  assert.deepEqual(after.get("rule"), before.get("rule"));
  for (const hostname of ["controlplane.tailscale.com", "login.tailscale.com"]) {
    const rule = `DOMAIN,${hostname},Auto`;
    assert.ok(after.get("rule").includes(rule));
    assert.ok(after.get("rule").indexOf(rule) < after.get("rule").indexOf("FINAL,FINAL,dns-failed"));
  }
});

test("Clash dials Tailnet variants through the Tailnet proxy while preserving the entire public configuration", async () => {
  const input = fixture();
  const baseline = await convertSurgeToClash(renderSurgeProfile(input), context);
  const derived = await convertSurgeToClash(renderSurgeProfile({ ...input, tailnetEndpoints }), context);
  const variants = derived.config.proxies.filter(({ name }) => name.startsWith("Tailnet Test - "));
  assert.deepEqual(variants.map(({ name }) => name), createTailnetNodes(input.nodes, tailnetEndpoints).map(({ name }) => name));
  for (const variant of variants) {
    const original = baseline.config.proxies.find(({ name }) => `Tailnet Test - ${name}` === variant.name);
    assert.deepEqual(variant, { ...original, name: variant.name, server: endpoint.hostname, servername: endpoint.hostname, "skip-cert-verify": false, "dialer-proxy": "Tailnet" });
  }
  assert.deepEqual(derived.config["proxy-groups"].find(({ name }) => name === "Tailnet Test"), { name: "Tailnet Test", type: "select", proxies: variants.map(({ name }) => name) });
  assert.ok(!derived.config["proxy-groups"].find(({ name }) => name === "Auto").proxies.some((name) => name.startsWith("Tailnet")));
  const withoutVariants = {
    ...derived.config,
    proxies: derived.config.proxies.filter((proxy) => !variants.includes(proxy)),
    "proxy-groups": derived.config["proxy-groups"].filter(({ name }) => name !== "Tailnet Test")
      .map((group) => ({ ...group, proxies: group.proxies.filter((name) => name !== "Tailnet Test") })),
  };
  assert.deepEqual(withoutVariants, baseline.config);
  assert.doesNotMatch(derived.warnings.join("\n"), /node\.example-tailnet\.ts\.net|11111111/);
});

test("Tailnet mapping is optional and matches only the configured server and port", () => {
  const input = fixture();
  for (const config of [undefined, "", "[]", JSON.stringify([{ ...endpoint, port: 8443 }])]) {
    assert.deepEqual(createTailnetNodes(input.nodes, config), []);
    assert.doesNotMatch(renderSurgeProfile({ ...input, tailnetEndpoints: config }), /^Tailnet Test(?: - | =)/m);
  }
});

test("invalid mappings and incompatible TLS or transport settings fail without exposing secrets", () => {
  const { nodes } = fixture();
  const invalid = ["NEVER_LOG_THIS", "null", "{}", JSON.stringify([endpoint, endpoint]),
    ...[{ port: 0 }, { port: 65536 }, { port: "443" }, { hostname: "public.example.com" },
      { hostname: "bad.ts.net\n[Rule]" }, { server: "bad,host" }, { password: "NEVER_LOG_THIS" }]
      .map((change) => JSON.stringify([{ ...endpoint, ...change }]))];
  const safeError = (error) => error.status === 503 && !/NEVER_LOG_THIS|11111111|hk\.example/.test(error.message);
  for (const config of invalid) assert.throws(() => createTailnetNodes(nodes, config), safeError);
  for (const option of ["underlying-proxy=NEVER_LOG_THIS", "server-cert-fingerprint-sha256=NEVER_LOG_THIS", "ws=true"])
    assert.throws(() => createTailnetNodes([{ ...nodes[0], value: `${value}, ${option}` }], tailnetEndpoints), safeError);
  assert.throws(() => createTailnetNodes([{ ...nodes[0], value: value.replace("tls=true", "tls=false") }], tailnetEndpoints), safeError);
  assert.throws(() => createTailnetNodes([...nodes, { ...nodes[0], name: `Tailnet Test - ${nodes[0].name}` }], tailnetEndpoints), safeError);
});
