import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { isPreviewIdentity, readPreviewProfile } from "../src/page-preview.js";
import { callSubscriptionStore } from "../src/subscription-store.js";
import { createD1Env } from "../test-helpers/d1.js";

const email = "preview@example.com";
const hash = createHash("sha256").update(email).digest("hex");

test("preview identities use normalized email digests and reject malformed configuration", async () => {
  assert.equal(await isPreviewIdentity(email, {}), false);
  assert.equal(await isPreviewIdentity(` ${email.toUpperCase()} `, { PREVIEW_EMAIL_HASHES: ` ${hash.toUpperCase()},${"0".repeat(64)}` }), true);
  assert.equal(await isPreviewIdentity("other@example.com", { PREVIEW_EMAIL_HASHES: hash }), false);
  for (const value of ["invalid", `,${hash}`, [hash]]) {
    await assert.rejects(isPreviewIdentity(email, { PREVIEW_EMAIL_HASHES: value }), (error) => error.status === 503);
  }
});

test("storage refuses preview account creation and rotation, and rejects existing production tokens", async () => {
  const blocked = { PREVIEW_EMAIL_HASHES: hash, DB: { prepare: () => assert.fail("Preview registration must not touch storage"), batch: () => assert.fail("Preview registration must not touch storage") } };
  for (const action of ["account", "rotate-token"]) {
    await assert.rejects(callSubscriptionStore(blocked, { action, identity: { email } }), (error) => error.status === 403);
  }
  const env = createD1Env();
  await callSubscriptionStore(env, { action: "save-inventory", revision: 0, nodes: [{ id: "one", line: "🇺🇸 Example ISP = trojan, example.com, 443, password=TEST_ONLY" }] });
  const old = await callSubscriptionStore(env, { action: "account", identity: { email } });
  const normal = await callSubscriptionStore(env, { action: "account", identity: { email: "member@example.com" } });
  const writes = env.writeCount;
  env.PREVIEW_EMAIL_HASHES = hash;
  await assert.rejects(callSubscriptionStore(env, { action: "subscription", token: old.subscribeToken }), (error) => error.status === 401);
  const subscription = await callSubscriptionStore(env, { action: "subscription", token: normal.subscribeToken });
  assert.equal(subscription.groups.length, 1);
  assert.equal(env.writeCount, writes);
});

test("database previews show an empty pool without fixtures and fail when storage is unavailable", async () => {
  const env = createD1Env();
  const profile = await readPreviewProfile(env);
  assert.equal(profile.nodeSource, "database");
  assert.equal(profile.status, "pending");
  assert.deepEqual(profile.groups, []);
  assert.equal(env.writeCount, 0);
  await assert.rejects(readPreviewProfile({}), (error) => error.status === 503);
});
