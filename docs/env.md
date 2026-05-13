# Worker Env

AtlasRouter 需要一个 KV namespace：

- `ATLAS_ROUTER`：Cloudflare KV namespace，存放租户订阅 token 和节点列表。

GitHub 不保存部署 token 或节点信息。部署由 Cloudflare Git Integration 触发，租户订阅 token 和节点信息保存在 `ATLAS_ROUTER` KV 中。KV 读权限视为订阅敏感配置读取权限。

管理页依赖 Cloudflare Access 保护 `/admin*`，Worker 会校验 Access 注入的 JWT。需要配置这些 Worker vars：

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
          "name": "US-01",
          "group": "🇺🇸 US",
          "value": "trojan, us.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=us.example.com"
        },
        {
          "name": "JP-01",
          "group": "🇯🇵 JP",
          "value": "trojan, jp.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=jp.example.com"
        },
        {
          "name": "US-HOME-01",
          "group": "🇺🇸 US Home",
          "value": "trojan, us-home.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=us-home.example.com"
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

`value` 直接使用 Surge `[Proxy]` 中等号右侧的节点语法。最终输出会渲染为：

```text
name = value
```
