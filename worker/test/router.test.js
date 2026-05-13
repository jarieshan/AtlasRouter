import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { handleRequest } from "../src/index.js";

const TEAM_DOMAIN = "https://team.cloudflareaccess.com";
const ACCESS_AUD = "access-aud";
const ADMIN_EMAIL = "admin@example.com";
const ACCESS_KID = "test-key";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const accessJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: ACCESS_KID,
  alg: "RS256",
  use: "sig",
};

const nodes = createNodes("01");
const tenantNodes = createNodes("02");
const env = createEnv();

test("rejects unauthorized requests", async () => {
  const response = await handleRequest(new Request("https://atlas.example/atlas-router"), env);

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Unauthorized");
});

test("renders Surge profile for matching tenant token", async () => {
  const response = await handleRequest(new Request("https://atlas.example/atlas-router?token=test-token"), env);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /^#!MANAGED-CONFIG https:\/\/atlas\.example\/atlas-router\?token=test-token/m);
  assert.match(body, /US-01 = trojan, us-01\.example\.com, 443, password=secret, sni=us-01\.example\.com/);
  assert.match(body, /JP-01 = trojan, jp-01\.example\.com, 443, password=secret, sni=jp-01\.example\.com/);
  assert.match(body, /US-HOME-01 = trojan, us-home-01\.example\.com, 443, password=secret, sni=us-home-01\.example\.com/);
  assert.match(body, /^dns-server = 223\.5\.5\.5, 119\.29\.29\.29, system$/m);
  assert.match(body, /^encrypted-dns-server = https:\/\/cloudflare-dns\.com\/dns-query,https:\/\/dns\.google\/dns-query,https:\/\/223\.5\.5\.5\/dns-query$/m);
  assert.match(body, /🚀 Select = select, 🇺🇸 US, 🇯🇵 JP, 🇺🇸 US Home, ♻️ Auto, DIRECT/);
  assert.match(body, /🤖 AIProxy = select, 🇺🇸 US Home, 🇺🇸 US, 🇯🇵 JP, ♻️ Auto/);
  assert.match(body, /🇺🇸 US = smart, US-01/);
  assert.match(body, /🇯🇵 JP = smart, JP-01/);
  assert.match(body, /🇺🇸 US Home = smart, US-HOME-01/);
  assert.doesNotMatch(body, /policy-regex-filter/);
  assert.doesNotMatch(body, /NODE_GROUP/);
  assert.match(body, /DOMAIN-SUFFIX,longbridge\.global,DIRECT/);
  assert.match(body, /DOMAIN-SUFFIX,kaggle\.com,🇺🇸 US/);
  assert.match(body, /DOMAIN-SUFFIX,buyee\.jp,🇯🇵 JP/);
  assert.match(body, /RULE-SET,SYSTEM,DIRECT/);
  assert.match(body, /RULE-SET,https:\/\/cdn\.jsdelivr\.net\/gh\/blackmatrix7\/ios_rule_script@master\/rule\/Surge\/OpenAI\/OpenAI\.list,🤖 AIProxy,update-interval=86400/);
  assert.match(body, /RULE-SET,https:\/\/cdn\.jsdelivr\.net\/gh\/blackmatrix7\/ios_rule_script@master\/rule\/Surge\/Telegram\/Telegram\.list,🚀 Select,update-interval=86400/);
  assert.match(body, /FINAL,🚀 Select/);
});

test("renders different nodes for another tenant token", async () => {
  const response = await handleRequest(new Request("https://atlas.example/atlas-router?token=tenant-token"), env);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /US-02 = trojan, us-02\.example\.com, 443/);
  assert.doesNotMatch(body, /US-01 = trojan/);
});

test("renders admin page without reading KV", async () => {
  const response = await handleRequest(new Request("https://atlas.example/atlas"), {});
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(body, /AtlasRouter Admin/);
  assert.doesNotMatch(body, /admin_token|Admin token|authorization/i);
});

test("rejects admin config without Cloudflare Access JWT", async () => {
  const response = await handleRequest(new Request("https://atlas.example/atlas/config"), env);

  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Missing Cloudflare Access token");
});

test("rejects admin query token", async () => {
  const response = await handleRequest(new Request("https://atlas.example/atlas/config?admin_token=admin-token"), env);

  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Missing Cloudflare Access token");
});

test("rejects Cloudflare Access JWT for non-admin email", async () => {
  const response = await handleRequest(
    new Request("https://atlas.example/atlas/config", {
      headers: accessHeaders({ email: "other@example.com" }),
    }),
    env,
  );

  assert.equal(response.status, 403);
  assert.equal(await response.text(), "Forbidden");
});

test("returns admin config with Cloudflare Access JWT", async () => {
  const response = await handleRequest(
    new Request("https://atlas.example/atlas/config", {
      headers: accessHeaders(),
    }),
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.adminToken, undefined);
  assert.deepEqual(body.profiles.map((profile) => profile.id), ["primary", "tenant"]);
  assert.equal(body.profiles[0].nodes[0].name, undefined);
  assert.equal(body.profiles[0].nodes[0].value, undefined);
  assert.match(body.profiles[0].nodes[0].line, /^US-01 = trojan/);
});

test("updates admin config with Cloudflare Access JWT", async () => {
  const writableEnv = createEnv();
  const nextConfig = createConfig({
    profiles: [
      {
        id: "primary",
        name: "Primary",
        subscribeToken: "new-token",
        nodes,
      },
    ],
  });

  const response = await handleRequest(
    new Request("https://atlas.example/atlas/config", {
      method: "PUT",
      headers: {
        ...accessHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify(nextConfig),
    }),
    writableEnv,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.adminToken, undefined);
  assert.equal(body.profiles[0].subscribeToken, "new-token");
  assert.deepEqual(JSON.parse(writableEnv.writtenValue), body);
});

test("creates admin config with Cloudflare Access JWT when KV key is missing", async () => {
  const writableEnv = createEnv();
  writableEnv.ATLAS_ROUTER.get = async () => {
    assert.fail("PUT /atlas/config should not read existing router-config");
  };
  const nextConfig = createConfig({
    profiles: [
      {
        id: "primary",
        name: "Primary",
        subscribeToken: "new-token",
        nodes,
      },
    ],
  });

  const response = await handleRequest(
    new Request("https://atlas.example/atlas/config", {
      method: "PUT",
      headers: {
        ...accessHeaders(),
        "content-type": "application/json",
      },
      body: JSON.stringify(nextConfig),
    }),
    writableEnv,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(writableEnv.writtenValue), body);
});

test("omits configured node groups that have no nodes", async () => {
  const response = await handleRequest(
    new Request("https://atlas.example/atlas-router?token=test-token"),
    createEnv(createConfig({
      profiles: [
        {
          id: "primary",
          name: "Primary",
          subscribeToken: "test-token",
          nodes: [
            {
              group: "🇺🇸 US",
              line: "US-01 = trojan, us.example.com, 443, password=secret, sni=us.example.com",
            },
          ],
        },
      ],
    })),
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /US-01 = trojan, us\.example\.com, 443/);
  assert.match(body, /🚀 Select = select, 🇺🇸 US, ♻️ Auto, DIRECT/);
  assert.match(body, /🤖 AIProxy = select, 🇺🇸 US, ♻️ Auto/);
  assert.match(body, /🎥 GlobalMedia = select, 🇺🇸 US, ♻️ Auto/);
  assert.match(body, /🇺🇸 US = smart, US-01/);
  assert.doesNotMatch(body, /🇯🇵 JP/);
  assert.doesNotMatch(body, /🇺🇸 US Home/);
  assert.doesNotMatch(body, /NODE_GROUP/);
  assert.match(body, /DOMAIN-SUFFIX,buyee\.jp,🚀 Select/);
});

test("rejects nodes that reference a group missing from template", async () => {
  const response = await handleRequest(
    new Request("https://atlas.example/atlas-router?token=test-token"),
    createEnv(createConfig({
      profiles: [
        {
          id: "primary",
          name: "Primary",
          subscribeToken: "test-token",
          nodes: [
            ...nodes,
            {
              group: "🇭🇰 HK",
              line: "HK-01 = trojan, hk.example.com, 443, password=secret, sni=hk.example.com",
            },
          ],
        },
      ],
    })),
  );

  assert.equal(response.status, 500);
  assert.equal(await response.text(), "Node HK-01 references unknown node group: 🇭🇰 HK");
});

test("returns 404 for unknown route", async () => {
  const response = await handleRequest(new Request("https://atlas.example/unknown?token=test-token"), env);

  assert.equal(response.status, 404);
});

test("returns 404 for retired routes before reading config", async () => {
  const unreadableEnv = createEnv();
  unreadableEnv.ATLAS_ROUTER.get = async () => {
    assert.fail("retired routes should not read router-config");
  };

  for (const path of ["/surge", "/surge.conf", "/admin", "/admin/config", "/modules/unknown.sgmodule", "/modules/%E0%A4%A"]) {
    const response = await handleRequest(new Request(`https://atlas.example${path}`), unreadableEnv);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not Found");
  }
});

function createNodes(suffix) {
  return [
    {
      group: "🇺🇸 US",
      line: `US-${suffix} = trojan, us-${suffix}.example.com, 443, password=secret, sni=us-${suffix}.example.com`,
    },
    {
      group: "🇯🇵 JP",
      line: `JP-${suffix} = trojan, jp-${suffix}.example.com, 443, password=secret, sni=jp-${suffix}.example.com`,
    },
    {
      group: "🇺🇸 US Home",
      line: `US-HOME-${suffix} = trojan, us-home-${suffix}.example.com, 443, password=secret, sni=us-home-${suffix}.example.com`,
    },
  ];
}

function createConfig(overrides = {}) {
  return {
    profiles: [
      {
        id: "primary",
        name: "Primary",
        subscribeToken: "test-token",
        nodes,
      },
      {
        id: "tenant",
        name: "Tenant",
        subscribeToken: "tenant-token",
        nodes: tenantNodes,
      },
    ],
    ...overrides,
  };
}

function createEnv(config = createConfig()) {
  const env = {
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD,
    ADMIN_EMAILS: ADMIN_EMAIL,
    ACCESS_JWKS_JSON: JSON.stringify({ keys: [accessJwk] }),
    ATLAS_ROUTER: {
      async get(key, type) {
        assert.equal(key, "router-config");
        assert.equal(type, "json");
        return config;
      },
      async put(key, value) {
        assert.equal(key, "router-config");
        env.writtenValue = value;
      },
    },
  };
  return env;
}

function accessHeaders(overrides = {}) {
  return {
    "cf-access-jwt-assertion": createAccessJwt({
      email: ADMIN_EMAIL,
      ...overrides,
    }),
  };
}

function createAccessJwt(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    kid: ACCESS_KID,
    typ: "JWT",
  };
  const payload = {
    iss: TEAM_DOMAIN,
    aud: ACCESS_AUD,
    email: ADMIN_EMAIL,
    exp: now + 3600,
    nbf: now - 60,
    ...overrides,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value)));
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
