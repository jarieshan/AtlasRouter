# Subscription

Cloudflare Worker 提供订阅路由和管理路由：

- `/atlas-router?token=<subscribeToken>`：输出完整 Surge 配置。
- `/modules/<name>.sgmodule?token=<subscribeToken>`：输出 Surge 模块。
- `/atlas`：浏览器管理页。
- `/atlas/config`：受 Cloudflare Access 保护的配置读写 API。

`/atlas` 和 `/atlas/config` 应配置 Cloudflare Access application。不要用 `/atlas*` 这类会匹配 `/atlas-router` 的通配路径，避免订阅入口被 Access 拦截。Worker 会校验 Access 注入的 JWT，并用 `ADMIN_EMAILS` 做二次邮箱白名单；不支持 URL 查询参数或 `Authorization: Bearer` 作为管理凭证。

Surge 订阅地址使用：

```text
https://<worker-domain>/atlas-router?token=<subscribeToken>
```

生成的 Surge 配置会包含：

- `#!MANAGED-CONFIG`，用于托管配置更新。
- `[Proxy]`，由 `ATLAS_ROUTER` KV 中匹配租户的 `profile.nodes` 渲染。
- `[Proxy Group]`，包含手动选择、自动测速、AI、流媒体和显式节点组。
- `[Rule]`，由 `surge/template.conf` 维护规则集、`GEOIP` 和 `FINAL`，由 `surge/rules.list` 插入零散自定义规则。
- `FINAL,🚀 Select` 兜底，默认按 `🚀 Select` 的首个可用节点组处理。
- `🤖 AIProxy` 有 `🇺🇸 US Home` 节点时默认优先家宽中转；缺少某个节点组时，该组会从策略组列表中移除，直接引用该空组的自定义规则会回退到 `🚀 Select`。

每个 `profiles[]` 条目都有独立的 `subscribeToken` 和节点列表。`/atlas-router?token=...` 会按 token 匹配对应 profile，下发该租户自己的配置。

如果订阅返回 `401 Unauthorized`，检查 URL 中的 token 是否与某个 KV `router-config.profiles[].subscribeToken` 一致。
