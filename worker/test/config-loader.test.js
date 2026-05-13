import assert from "node:assert/strict";
import test from "node:test";

import { loadRouterConfig, parseRouterConfig, saveRouterConfig, serializeRouterConfig } from "../src/config-loader.js";

const validNodes = [
  {
    name: "US-01",
    group: "🇺🇸 US",
    value: "trojan, us.example.com, 443, password=secret, sni=us.example.com",
  },
];

test("loads router config from KV", async () => {
  const config = await loadRouterConfig(createEnv(createConfig()));

  assert.equal(config.profiles[0].id, "primary");
  assert.equal(config.profiles[0].subscribeToken, "test-token");
  assert.deepEqual(config.profiles[0].nodes.map((node) => node.name), ["US-01"]);
});

test("loads legacy single-profile router config", () => {
  const config = parseRouterConfig({ subscribeToken: "test-token", nodes: validNodes });

  assert.deepEqual(serializeRouterConfig(config), {
    profiles: [
      {
        id: "default",
        name: "Default",
        subscribeToken: "test-token",
        nodes: validNodes,
      },
    ],
  });
});

test("rejects missing KV binding", async () => {
  await assert.rejects(() => loadRouterConfig({}), /ATLAS_ROUTER KV binding is not configured/);
});

test("rejects missing KV key", async () => {
  await assert.rejects(() => loadRouterConfig(createEnv(null)), /ATLAS_ROUTER key router-config is not configured/);
});

test("rejects invalid KV JSON", async () => {
  await assert.rejects(() => loadRouterConfig(createEnv(new SyntaxError("bad json"))), /valid JSON/);
});

test("rejects non-object config", async () => {
  await assert.rejects(() => loadRouterConfig(createEnv([])), /must be a JSON object/);
});

test("rejects missing legacy subscribeToken", async () => {
  await assert.rejects(
    () => loadRouterConfig(createEnv({ nodes: validNodes })),
    /subscribeToken/,
  );
});

test("rejects duplicate profile ids", () => {
  assert.throws(
    () =>
      parseRouterConfig({
        profiles: [
          { id: "primary", name: "Primary", subscribeToken: "one", nodes: validNodes },
          { id: "primary", name: "Primary copy", subscribeToken: "two", nodes: validNodes },
        ],
      }),
    /Duplicate profile id/,
  );
});

test("rejects duplicate profile tokens", () => {
  assert.throws(
    () =>
      parseRouterConfig({
        profiles: [
          { id: "one", name: "One", subscribeToken: "same", nodes: validNodes },
          { id: "two", name: "Two", subscribeToken: "same", nodes: validNodes },
        ],
      }),
    /Duplicate subscribeToken/,
  );
});

test("saves normalized router config to KV", async () => {
  const env = createEnv(createConfig());

  const saved = await saveRouterConfig(env, createConfig());

  assert.equal(saved.profiles[0].id, "primary");
  assert.deepEqual(JSON.parse(env.writtenValue), serializeRouterConfig(saved));
});

function createConfig() {
  return {
    profiles: [
      {
        id: "primary",
        name: "Primary",
        subscribeToken: "test-token",
        nodes: validNodes,
      },
    ],
  };
}

function createEnv(value) {
  const env = {
    ATLAS_ROUTER: {
      async get(key, type) {
        assert.equal(key, "router-config");
        assert.equal(type, "json");
        if (value instanceof Error) {
          throw value;
        }
        return value;
      },
      async put(key, nextValue) {
        assert.equal(key, "router-config");
        env.writtenValue = nextValue;
      },
    },
  };
  return env;
}
