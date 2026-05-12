# Worker Env

AtlasRouter 初版只需要两个 Worker Secrets：

- `SUBSCRIBE_TOKEN`：订阅访问 token。
- `NODES_JSON`：节点列表，JSON 字符串。

GitHub Actions Secrets 只用于部署，不保存节点信息：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## NODES_JSON

结构化节点示例：

```json
[
  {
    "name": "US-01 美国",
    "type": "trojan",
    "server": "us.example.com",
    "port": 443,
    "password": "REPLACE_WITH_PASSWORD",
    "sni": "us.example.com",
    "skipCertVerify": false
  },
  {
    "name": "JP-01 日本",
    "type": "vmess",
    "server": "jp.example.com",
    "port": 443,
    "uuid": "00000000-0000-4000-8000-000000000000"
  }
]
```

如果协议参数比较复杂，使用 `surgeProxy` 直接写 Surge `[Proxy]` 右侧语法：

```json
[
  {
    "name": "Raw-01",
    "surgeProxy": "trojan, raw.example.com, 443, password=REPLACE_WITH_PASSWORD, sni=raw.example.com"
  }
]
```

结构化字段不允许包含逗号；遇到逗号或特殊参数时，使用 `surgeProxy`。

区域策略组会根据节点名称动态生成。需要区域组时，节点名中保留 `US`、`美国`、`JP`、`日本`、`SG`、`新加坡`、`HK`、`香港` 等地区关键词。

## 支持的结构化类型

- `http`
- `https`
- `socks5`
- `socks5-tls`
- `ss`
- `snell`
- `vmess`
- `trojan`
- `tuic`
- `hysteria2`
- `anytls`

额外参数可以放到 `params` 对象中，键名会原样写入 Surge 参数：

```json
[
  {
    "name": "US-02",
    "type": "trojan",
    "server": "us2.example.com",
    "port": 443,
    "password": "REPLACE_WITH_PASSWORD",
    "params": {
      "test-url": "http://www.gstatic.com/generate_204"
    }
  }
]
```
