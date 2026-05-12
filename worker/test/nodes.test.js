import assert from "node:assert/strict";
import test from "node:test";

import { parseNodesText, renderProxyLines } from "../src/nodes.js";

test("parses Surge proxy lines", () => {
  const nodes = parseNodesText(`
# comments are ignored
US-01 美国 = trojan, us.example.com, 443, password=secret, sni=us.example.com
JP-01 日本 = vmess, jp.example.com, 443, username=00000000-0000-4000-8000-000000000000
`);

  assert.deepEqual(nodes.map((node) => node.name), ["US-01 美国", "JP-01 日本"]);
  assert.equal(
    renderProxyLines(nodes),
    [
      "US-01 美国 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
      "JP-01 日本 = vmess, jp.example.com, 443, username=00000000-0000-4000-8000-000000000000",
    ].join("\n"),
  );
});

test("rejects empty node text", () => {
  assert.throws(() => parseNodesText("# only comments"), /at least one proxy line/);
});

test("rejects invalid node lines", () => {
  assert.throws(() => parseNodesText("not a surge proxy line"), /name = type/);
});
