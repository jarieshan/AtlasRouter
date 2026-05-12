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

## 2. 配置 Worker Secrets

在 Cloudflare Dashboard 中进入 Worker：

```text
Settings
  -> Variables and Secrets
```

添加 Secrets：

```text
SUBSCRIBE_TOKEN
NODES_TEXT
```

也可以用 Wrangler 配置：

```sh
cd worker
npx wrangler secret put SUBSCRIBE_TOKEN
npx wrangler secret put NODES_TEXT
```

## 3. 本地验证

```sh
cd worker
npm test
npm run dev
```

本地调试时可以使用 Wrangler 的本地变量机制，但不要提交 `.dev.vars*` 或 `.env*`。

## 4. 部署

合并到 `main` 后，Cloudflare Workers Builds 会自动构建和部署。

手动部署：

```sh
cd worker
npm run deploy
```
