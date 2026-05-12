# Subscription

Cloudflare Worker 初版提供三个受 token 保护的 GET 路由：

- `/surge?token=<SUBSCRIBE_TOKEN>`：输出完整 Surge 配置。
- `/modules/<name>.sgmodule?token=<SUBSCRIBE_TOKEN>`：输出 Surge 模块。

Surge 订阅地址使用：

```text
https://<worker-domain>/surge?token=<SUBSCRIBE_TOKEN>
```

生成的 Surge 配置会包含：

- `#!MANAGED-CONFIG`，用于托管配置更新。
- `[Proxy]`，由 `NODES_TEXT` 渲染。
- `[Proxy Group]`，包含手动选择、自动测速、AI、流媒体和区域策略组。
- `[Rule]`，由 `surge/template.conf` 维护规则集、`GEOIP` 和 `FINAL`，由 `surge/rules.list` 插入零散自定义规则。
- `FINAL,♻️ Auto` 兜底。

如果订阅返回 `401 Unauthorized`，检查 URL 中的 token 是否与 Worker Secret `SUBSCRIBE_TOKEN` 一致。
