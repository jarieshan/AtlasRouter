# Cloudflare Deployment

使用已有的 `atlas-router` Worker。Cloudflare Workers Builds 直接监听 GitHub：`master` 是生产分支，`develop` 发布到同一 Worker 的原生 Preview。GitHub Actions 只做验证。

master 使用权重实验前的稳定 fallback 行为，并提供生产 Dev 按钮；develop 保留 Smart 权重。基线与发布边界见 [生产基线](production-baseline.md)。后续只通过 Cloudflare 监听分支推送发布，不从本机手工部署。

## 1. 域名

进入 Workers & Pages → `atlas-router` → Domains，在 Custom Domains and Routes 中找到 `atlasrouter.zslab.ai`，将 Enable for 设为 **Production and Preview**。保留原生产域名，不需要创建第二个 Worker，也不要把 `develop.atlasrouter.zslab.ai` 作为另一个生产 Custom Domain 添加。

原生 Preview 名称固定为 `develop`，预览域名因此是 `develop.atlasrouter.zslab.ai`。确认域名和证书生效后再使用该地址；更深的子域名可能需要额外的证书覆盖，不能只凭生产 HTTPS 正常就认为预览 HTTPS 正常。参见 [Cloudflare 预览域名](https://developers.cloudflare.com/workers/previews/custom-domains/)。

## 2. Git 连接与构建

如果仍连接着之前使用 `setup:builds` 的自定义双分支触发器，先在 Settings → Builds 中 Disconnect，再连接同一个 `jarieshan/AtlasRouter` 仓库，以清除旧的触发器配置。这不删除 Worker 或 D1。不要再次运行旧设置脚本。参见 [断开 Builds](https://developers.cloudflare.com/workers/ci-cd/builds/#disconnecting-builds)。

在该 Worker 的 Settings → Builds 中设置：

| 设置 | 值 |
| --- | --- |
| Repository | `jarieshan/AtlasRouter` |
| Production branch | `master` |
| Root directory | `worker` |
| Build command | `npm ci && npm test` |
| Deploy command | `npm run deploy` |
| Preview Builds | 开启 |
| Preview command | `npm run deploy:preview` |

`master` 保持生产分支。原先的 `npx wrangler deploy --dry-run` 只构建、不发布，必须改为 `npm run deploy` 才会更新生产 UI。命令只接受 Cloudflare Builds 的 master 构建上下文，依次迁移正式库和 UI 使用的测试库，再发布生产代码并轮换管理路径；迁移失败不发布。

如果页面出现 **Set up Worker Previews**，按提示切换到原生 Worker Previews，然后再次确认 Preview command 为 `npm run deploy:preview`。这是 Cloudflare 的一次性切换，不能切回旧 Version URL 预览模型。参见 [Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)。

开启 Preview Builds 后，其他非生产分支也可能触发构建，但本项目发布脚本只在 `WORKERS_CI_BRANCH=develop` 时迁移或发布；其他分支跳过。每次 develop 推送更新同一个固定预览地址。

## 3. 构建 Token 与 D1

继续使用 Builds 当前选择的用户 API token。到 My Profile → API Tokens 编辑**同一个 token**，在原有权限之外补 **Account → D1 → Edit**，使预览发布命令能执行开发库迁移。不需要新建一个独立 token，不需要把 token 填入 GitHub、聊天或 `.env`。原先为旧设置脚本添加的 Workers Builds Configuration → Edit 不再是本流程所需权限。Cloudflare 的默认 Builds token 权限不含 D1，参见 [Builds API token](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)。

沿用独立的 `atlas-router-dev` 数据库。[wrangler.jsonc](../worker/wrangler.jsonc) 已配置：

- 生产 `DB` → `atlas-router`；生产 `DEV_DB` → `atlas-router-dev`，供生产 UI 管理测试用户和节点。
- 原生 Preview `DB` → `atlas-router-dev`；Preview 不绑定生产数据库。
- develop 分支的 Preview 配置为 `UI_ENABLED=false`、`SUBSCRIPTION_PATH=/AtlasRouter-Dev`、`SMART_PRIORITY_SCHEME=geometric-3`；master 不配置或读取权重变量。

不用在手机上逐项填写这些 bindings 和 variables。开发发布脚本先核对 `DEV_DB` 与 Preview `DB` 指向同一个开发库、且不同于生产库，再执行开发库迁移，最后上传 Preview。它不会执行生产 D1 迁移，也不上传生产版本。

生产 `DEV_DB` binding 和 Dev 按钮会随 master 的成功发布一起生效；只有构建成功、没有实际发布时，线上页面不会变化。开发库节点和用户保持独立，不自动复制生产数据。

## 4. Access 与验证

保留生产页面、`/api` 和已有订阅路径的 Access 配置。开发 Preview 默认没有管理页面；如果账号的 Access 设置覆盖了开发域名，给 `develop.atlasrouter.zslab.ai/AtlasRouter-Dev` 及其子路径配置精确的 Bypass（Everyone），让订阅客户端可以访问。应用仍校验个人订阅 Token。不要放开整个生产域名或生产 `/api`。

在完成配置、并确认 develop 已包含 `deploy:preview` 后，触发一次 develop 的新构建。检查构建日志：运行测试 → 迁移 `DEV_DB` → 发布 `develop` Preview；不应出现生产 `wrangler deploy` 上传。

- `https://develop.atlasrouter.zslab.ai/` 到达 Worker 后返回 404，是关闭 UI 的预期结果；若 Access 覆盖此路径，可能先跳转到登录页。
- `https://develop.atlasrouter.zslab.ai/AtlasRouter-Dev` 未携带 Token 时返回 401，是鉴权生效的预期结果。
- 成功订阅还需测试库有可用节点及有效测试 Token。生产页面的 Dev 按钮在后续生产更新后负责生成链接，不能用生产 Token 替代测试 Token。

master 构建成功发布后，刷新生产首页，应在页头看到 Dev 按钮。它在生产页面切换测试数据，生成独立开发域名与 `/AtlasRouter-Dev` 路径；Preview 根页面仍关闭。发布失败时以 Cloudflare 构建日志定位，修正后在 Cloudflare 重试该分支构建，不改为本地手工部署。
