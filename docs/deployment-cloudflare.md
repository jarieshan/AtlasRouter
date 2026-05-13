# Cloudflare Deployment

初版部署链路：

```text
GitHub main
  -> Cloudflare Workers Builds
  -> Cloudflare Worker
```

## 1. 导入 GitHub 仓库

在 Cloudflare Dashboard 中：

```text
Workers & Pages
  -> Create application
  -> Import a repository
  -> 选择 jarieshan/AtlasRouter
```

构建配置：

```text
Root directory: worker
Build command: npm run generate
Deploy command: npx wrangler deploy
```

Worker 名称使用 `worker/wrangler.jsonc` 中的 `atlas-router`。

## 2. 配置 KV

创建一个 KV namespace，并把 namespace ID 填入 `worker/wrangler.jsonc` 的 `ATLAS_ROUTER` binding。

```sh
cd worker
npx wrangler kv namespace create ATLAS_ROUTER
```

在 `ATLAS_ROUTER` 中写入固定 key `router-config`。值为 JSON 对象：

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

也可以用 Wrangler 写入：

```sh
npx wrangler kv key put --binding=ATLAS_ROUTER router-config "$(cat router-config.json)"
```

## 3. 配置 Cloudflare Access

在 Cloudflare Zero Trust 中为管理页创建 Access application，保护 Worker 域名下的 `/admin*`：

```text
https://<worker-domain>/admin*
```

Access policy 只允许自己的账号访问。然后在 Worker 的 Settings -> Variables and Secrets 中配置：

```text
ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
ACCESS_AUD=REPLACE_WITH_ACCESS_APPLICATION_AUD
ADMIN_EMAILS=you@example.com
```

不要把这些真实值写进 `worker/wrangler.jsonc`。`ACCESS_AUD` 使用 Access application 详情页里的 Audience (AUD)。`ADMIN_EMAILS` 是 Worker 内部的二次白名单，用来避免 Access policy 配错时放大管理面。

部署后也可以打开管理页，粘贴完整 JSON 并保存到 `router-config`：

```text
https://<worker-domain>/admin
```

通过 Cloudflare Access 登录后，管理页会读取或保存 `router-config`。Worker 不再接收管理 token，也不接受 URL 查询参数或 `Authorization: Bearer` 作为管理凭证。

## 4. 本地验证

```sh
cd worker
npm test
npm run dev
```

本地调试时可以使用 Wrangler 的本地变量机制，但不要提交 `.dev.vars*` 或 `.env*`。

## 5. 部署

合并到 `main` 后，Cloudflare Workers Builds 会自动构建和部署。

手动部署：

```sh
cd worker
npm run deploy
```
