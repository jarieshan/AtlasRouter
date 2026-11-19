import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../scripts/node-dns.js", import.meta.url), "utf8");
const key = "node-dns-node.example.com";
const answer = (...addresses) => JSON.stringify({ Status: 0, Answer: [{ type: 5, data: "edge.example.net." }, ...addresses.map((data) => ({ type: 1, data }))] });

// Replies are [request index, body] in arrival order; a null body is a request error.
// Surge keeps the first $done result of a DNS script.
function resolve(replies, store = {}) {
  const requests = [];
  const results = [];
  vm.runInNewContext(source, {
    $domain: "node.example.com",
    $httpClient: { get: (options, callback) => requests.push({ options: { ...options }, callback }) },
    $persistentStore: { read: (name) => store[name] ?? null, write: (value, name) => { store[name] = value; return true; } },
    $done: (result) => results.push(JSON.parse(JSON.stringify(result))),
  });
  for (const [index, body] of replies) requests[index].callback(body === null ? "timeout" : null, body === null ? undefined : { status: 200 }, body ?? undefined);
  return { requests, result: results[0], store };
}

test("node DNS script queries AliDNS and DNSPod JSON directly and concurrently", () => {
  const { requests, result } = resolve([]);
  assert.deepEqual(requests.map(({ options }) => options), [
    { url: "https://223.5.5.5/resolve?name=node.example.com&type=1", timeout: 2, policy: "DIRECT" },
    { url: "https://1.12.12.12/resolve?name=node.example.com&type=1", timeout: 2, policy: "DIRECT" },
  ]);
  assert.equal(result, undefined);
});

test("node DNS script returns the first live answer with a TTL and saves it", () => {
  for (const replies of [
    [[0, answer("192.0.2.1", "192.0.2.2")]],
    [[0, null], [1, answer("192.0.2.1", "192.0.2.2")]],
    [[1, "<html>portal</html>"], [0, answer("192.0.2.1", "192.0.2.2")]],
  ]) {
    const { result, store } = resolve(replies, { [key]: "198.51.100.1" });
    assert.deepEqual(result, { addresses: ["192.0.2.1", "192.0.2.2"], ttl: 300 });
    assert.deepEqual(store, { [key]: "192.0.2.1,192.0.2.2" });
  }
  assert.deepEqual(resolve([[1, answer("192.0.2.1")], [0, answer("203.0.113.1")]]).result, { addresses: ["192.0.2.1"], ttl: 300 });
});

test("node DNS script falls back to the saved answer without a TTL, then to plain DNS", () => {
  const failures = [[0, null], [1, JSON.stringify({ Status: 3 })]];
  assert.equal(resolve(failures.slice(0, 1)).result, undefined);
  assert.deepEqual(resolve(failures, { [key]: "198.51.100.1,198.51.100.2" }).result, { addresses: ["198.51.100.1", "198.51.100.2"] });
  assert.deepEqual(resolve(failures).result, { servers: ["223.5.5.5", "119.29.29.29"] });
});
