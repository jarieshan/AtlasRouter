import { downloadMagicRuleSet, magicRuleSources, storeMagicRuleSet } from "./magic-rules.js";

// One list per run keeps a run with the largest list within the Workers Free CPU and subrequest limits.
// The rotation reaches every list only while this matches the cron interval in wrangler.jsonc.
export const CHECK_INTERVAL = 5 * 60 * 1000;
export const NOTIFY_AFTER = 2;
const BARK_URL = "https://api.day.app/push";
const CLIENT_NAMES = { surge: "Surge", mihomo: "Mihomo" };
const key = (row) => `${row.client}/${row.name}`;

export async function checkMagicRules(env, scheduledTime, fetcher = fetch) {
  const sources = magicRuleSources();
  const source = sources[Math.floor(scheduledTime / CHECK_INTERVAL) % sources.length];
  const registered = new Set(sources.map(key));
  const { results } = await env.DB.prepare("SELECT name, client, failures, notified FROM magic_rule_checks").all();
  const rows = new Map(results.filter((row) => registered.has(key(row))).map((row) => [key(row), { ...row }]));
  const current = rows.get(key(source)) ?? { name: source.name, client: source.client, failures: 0, notified: 0 };
  let failures = 0;
  try {
    await storeMagicRuleSet(env, source, await downloadMagicRuleSet(source, fetcher));
  } catch {
    failures = current.failures + 1;
  }
  const changed = new Set();
  if (failures !== current.failures) {
    rows.set(key(source), { ...current, failures });
    changed.add(key(source));
  }
  const pending = [...rows.values()].filter((row) => row.notified ? row.failures === 0 : row.failures >= NOTIFY_AFTER);
  if (pending.length && await notify(env, pending, fetcher)) {
    for (const row of pending) {
      row.notified = row.failures ? 1 : 0;
      changed.add(key(row));
    }
  }
  if (!changed.size) return;
  const updatedAt = new Date().toISOString();
  await env.DB.batch([...changed].map((id) => rows.get(id)).map((row) => env.DB.prepare(`INSERT INTO magic_rule_checks
    (name, client, failures, notified, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (name, client) DO UPDATE SET
    failures = excluded.failures, notified = excluded.notified, updated_at = excluded.updated_at`)
    .bind(row.name, row.client, row.failures, row.notified, updatedAt)));
}

async function notify(env, rows, fetcher) {
  const label = (row) => `${row.name}（${CLIENT_NAMES[row.client]}）`;
  const failed = rows.filter((row) => row.failures);
  const recovered = rows.filter((row) => !row.failures);
  if (!env.BARK_DEVICE_KEY) {
    console.warn(`MagicRule check: BARK_DEVICE_KEY is not set. Failing: ${failed.map(label).join(", ") || "none"}. Recovered: ${recovered.map(label).join(", ") || "none"}.`);
    return false;
  }
  const body = [
    failed.length ? `${failed.map((row) => `${label(row)}连续 ${row.failures} 次`).join("、")}检查失败。中转改用 D1 中最后一份有效副本，没有副本时返回 502。若清单已失效，按 MagicRule 官方索引更新 surge/magicrule.json；npm run check:magic-rules 会列出新地址。` : "",
    recovered.length ? `${recovered.map(label).join("、")}已恢复。` : "",
  ].filter(Boolean).join("\n");
  try {
    const response = await fetcher(BARK_URL, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        device_key: env.BARK_DEVICE_KEY,
        title: failed.length ? "AtlasRouter：MagicRule 规则检查失败" : "AtlasRouter：MagicRule 规则已恢复",
        body, group: "AtlasRouter",
      }),
      signal: AbortSignal.timeout(10000),
    });
    await response.body?.cancel();
    if (response.ok) return true;
    // Bark error messages can repeat the device key, so only the status is logged.
    console.warn(`MagicRule check: Bark returned HTTP ${response.status}.`);
  } catch {
    console.warn("MagicRule check: the Bark request failed.");
  }
  return false;
}
