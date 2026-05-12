# Cloudflare Deployment

初版部署链路：

```text
GitHub main
  -> GitHub Actions
  -> Wrangler deploy
  -> Cloudflare Worker
```

## 1. 配置 Worker Secrets

在 `worker/` 目录执行：

```sh
npx wrangler secret put SUBSCRIBE_TOKEN
npx wrangler secret put NODES_JSON
```

也可以在 Cloudflare Dashboard 的 Worker 设置页添加同名 Secrets。

## 2. 配置 GitHub Actions Secrets

在 GitHub 仓库设置中添加：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

API Token 只需要具备部署当前 Worker 所需权限。节点信息不要放到 GitHub。

## 3. 本地验证

```sh
cd worker
npm test
npm run dev
```

本地调试时可以使用 Wrangler 的本地变量机制，但不要提交 `.dev.vars*` 或 `.env*`。

## 4. 部署

合并到 `main` 后，`.github/workflows/deploy-worker.yml` 会触发部署。

手动部署：

```sh
cd worker
npm run deploy
```
