# Worker Env

AtlasRouter 初版只需要两个 Worker Secrets：

- `SUBSCRIBE_TOKEN`：订阅访问 token。
- `NODES_TEXT`：Surge 节点列表，一行一个节点。

GitHub 不保存部署 token 或节点信息。部署由 Cloudflare Git Integration 触发，运行时密钥只保存在 Cloudflare Worker Secrets 中。

## NODES_TEXT

`NODES_TEXT` 直接使用 Surge `[Proxy]` 中的节点行格式：

```text
US-01 美国 = trojan, us.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=us.example.com
JP-01 日本 = trojan, jp.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=jp.example.com
SG-01 新加坡 = trojan, sg.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=sg.example.com
```

可以添加空行和 `#` 注释，Worker 会忽略：

```text
# 美国节点
US-01 美国 = trojan, us.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=us.example.com

# 日本节点
JP-01 日本 = trojan, jp.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=jp.example.com
```

每一行必须是：

```text
节点名称 = Surge 节点语法
```

区域策略组会根据节点名称动态生成。需要区域组时，节点名中保留 `US`、`美国`、`JP`、`日本`、`SG`、`新加坡`、`HK`、`香港` 等地区关键词。
