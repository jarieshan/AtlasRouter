# Worker Env

AtlasRouter 需要一个 KV namespace：

- `ATLAS_ROUTER`：Cloudflare KV namespace，存放租户订阅 token 和节点列表。

GitHub 不保存部署 token 或节点信息。部署由 Cloudflare Git Integration 触发，租户订阅 token 和节点信息保存在 `ATLAS_ROUTER` KV 中。KV 读权限视为订阅敏感配置读取权限。

管理页依赖 Cloudflare Access 保护 `/admin*`，Worker 会校验 Access 注入的 JWT。需要在 Cloudflare Dashboard 的 Worker Variables and Secrets 中配置这些值，不要把真实值写进 `worker/wrangler.jsonc`：

- `ACCESS_TEAM_DOMAIN`：Cloudflare Access team domain，例如 `https://<team>.cloudflareaccess.com`。
- `ACCESS_AUD`：Access application 的 Audience (AUD)。
- `ADMIN_EMAILS`：允许管理配置的邮箱，多个邮箱用英文逗号分隔。

## ATLAS_ROUTER

KV 使用固定 key：

```text
router-config
```

值为 JSON 对象，包含 `profiles`。每个 profile 是一个租户配置：

```json
{
  "profiles": [
    {
      "id": "primary",
      "name": "Primary",
      "subscribeToken": "REPLACE_WITH_SUBSCRIBE_TOKEN",
      "nodes": [
        {
          "group": "🇺🇸 US",
          "line": "US-01 = trojan, us.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=us.example.com"
        },
        {
          "group": "🇯🇵 JP",
          "line": "JP-01 = trojan, jp.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=jp.example.com"
        },
        {
          "group": "🇺🇸 US Home",
          "line": "US-HOME-01 = trojan, us-home.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=us-home.example.com"
        }
      ]
    }
  ]
}
```

首次配置可以用 Wrangler 写入 `router-config`，也可以部署后访问 `/admin`，通过 Cloudflare Access 登录并粘贴完整 JSON 保存。

当前模板声明的节点组：

- `🇺🇸 US`
- `🇯🇵 JP`
- `🇺🇸 US Home`

节点组和策略组顺序维护在 `surge/template.conf`。新增节点组时，在 `[Proxy Group]` 中引用新组并添加对应 `{{NODE_GROUP:<group>}}` 占位符，然后在 KV 节点里使用完全相同的 `group` 值。

某个 profile 没有某个模板节点组的节点时，Worker 会在该 profile 的订阅输出中移除该显式节点组，并从逗号分隔的策略组列表里移除对应引用。`surge/rules.list` 中直接引用空节点组的自定义规则会回退到 `🚀 Select`。

`line` 直接使用 Surge `[Proxy]` 中的完整节点行。Worker 会自动从等号左侧拆出节点名，并把节点名放进对应节点组。旧的 `{ "name": "...", "group": "...", "value": "..." }` 格式仍可读取，但保存时会规范化为 `line`。

```text
节点名 = Surge 节点语法
```
