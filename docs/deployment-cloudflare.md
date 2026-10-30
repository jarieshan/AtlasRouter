# Cloudflare Deployment

首次部署顺序：创建 D1 → 本地首次部署 Worker 和域名 → 配置 Access 与 Worker 运行参数 → 登录验收 → 配置 GitHub Actions。

部署按 Git 分支选择环境：`develop` → 开发 Worker 和独立 D1，`master` → 生产订阅服务和测速站。PR 只验证，不部署；两个分支都先运行单元测试、workerd 集成测试及构建检查。工作流在 [worker.yml](../.github/workflows/worker.yml)。

| Git 分支 | GitHub Environment | Worker / 域名 | D1 |
| --- | --- | --- | --- |
| `develop` | `development` | `atlas-router-dev` / `atlasrouter-dev.zslab.ai` | `atlas-router-dev` |
| `master` | `production` | `atlas-router` / `atlasrouter.zslab.ai`；测速站沿用独立 Worker | `atlas-router` |

两端分别配置 Access 应用、AUD、管理员 Secret 和节点。开发库不复制生产用户、订阅 token、节点凭据或分配关系。需要先在开发管理页单独录入测试节点，才能用开发订阅进行真实线路测试。

在 `worker/` 目录使用统一部署入口；也可在仓库根目录为以下命令加上 `--prefix worker`：

| 命令 | 范围 |
| --- | --- |
| `npm run deploy` | 先迁移 D1、轮换管理路径并发布 `atlas-router`，成功后发布 `pulse-speedtest` |
| `npm run deploy -- --dry-run` | 检查两个 Worker，不执行远程迁移或发布 |
| `npm run deploy:router` | 仅部署订阅服务，包含迁移和管理路径轮换 |
| `npm run deploy:speedtest` | 仅部署测速站，不访问 D1、不轮换管理路径 |
| `npm run deploy:dev` | 仅迁移开发 D1、轮换开发管理路径并发布 `atlas-router-dev` |
| `npm run build:dev` | 检查开发配置与构建，不迁移或发布 |

两个 Worker 分别使用自己的 Wrangler 配置；订阅服务的临时 Secret 文件不会传给测速站。任一步失败会终止命令，但已经成功发布的 Worker 不会自动回滚。若仅测速站发布失败，修复后可用 `npm run deploy:speedtest` 重试。

开发配置独立保存在 [wrangler.dev.jsonc](../worker/wrangler.dev.jsonc)。开发部署脚本先检查 Worker 名称、域名和 D1 ID 与生产不同，再为迁移和发布显式传入开发配置；不会调用生产或测速站的部署命令。开发环境设置 `SMART_PRIORITY_SCHEME=geometric-3`，按个人主备顺序试验 1、3、9、27、81… 的 Smart 权重；Clash 仍转换为同顺序 fallback。这不提供连续失败次数或固定出口 IP 的保证。

## 1. Worker 和存储

使用 Node.js 24：

```sh
cd worker
npm ci
npm test
```

`wrangler.jsonc` 定义：

- Worker 名称 `atlas-router`。
- `DB` D1 binding，数据库名 `atlas-router`，保存用户、节点池和分配关系。
- `database_id` 必须与实际使用的 D1 数据库一致；切换 Cloudflare 账号或数据库时也要更新。
- 不再使用 `SUBSCRIPTIONS` Durable Object 或 `ATLAS_ROUTER` KV binding。
- `workers_dev: false`、`preview_urls: false`，对外访问使用 `routes` 中的 Custom Domain：`atlasrouter.zslab.ai`。

`zslab.ai` 需为目标 Cloudflare 账号下已激活的 Zone。部署时 Wrangler 会绑定 `atlasrouter.zslab.ai`，由 Cloudflare 创建 DNS 记录和 HTTPS 证书；无需另建指向 `workers.dev` 的 CNAME。同名已有 CNAME 会与 Custom Domain 冲突，需先确认其用途再调整。域名机制见 [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

```sh
npx wrangler login
npx wrangler d1 create atlas-router
```

把创建结果中的 `database_id` 填入 `worker/wrangler.jsonc` 的 `d1_databases[0].database_id`，保留 binding 名 `DB`。迁移按编号执行：`0001_configs.sql` 保留为历史迁移，[0002_relational.sql](../worker/migrations/0002_relational.sql) 创建关系表并删除旧 `configs` 表；历史迁移不改写，当前运行时只使用节点池相关表。新库无需导入数据，账号和节点由页面初始化。

下线旧版功能不需要新的数据库迁移，也不会删除已存数据。历史迁移留下的 `manual_*` 表不再由 Worker 读写。已有节点池用户、token、归属顺序和历史次数继续保留；旧手动订阅不再提供服务。不能将 Worker 回退到依赖旧 `configs` 表的版本。

`npm test` 使用临时本地 D1，不访问云数据库。`npm run dev` 会先执行本地迁移，再启动 Worker。需要单独应用迁移时使用：

```sh
npm run db:migrate:local
```

上线的 `npm run deploy` 会生成静态资产，再执行远程 D1 迁移；成功后为 `ADMIN_API_SLUG` 生成新值，并将该 Secret 与订阅 Worker 代码一同发布，最后发布测速站。资产生成或迁移失败时，两个 Worker 都不会发布，也不会轮换线上标识。数据库创建和迁移方式见 [D1 入门](https://developers.cloudflare.com/d1/get-started/)及 [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。配置结构见 [env.md](env.md)。

D1 ID 已填好且 Wrangler 已登录后，可在 `worker` 目录执行首次部署：

```sh
npm run deploy
```

该命令会应用远程 D1 迁移、创建或更新 `atlas-router` 与 `pulse-speedtest`，分别绑定 `atlasrouter.zslab.ai` 与 `speedtest.hosts.zslab.ai`。首次部署不依赖尚未填写的 Access 运行参数：此时订阅服务的根路径会返回 `500 ACCESS_TEAM_DOMAIN is not configured`，管理请求也会被拒绝，这是待配置状态。继续完成下文 Access 应用和 Worker 变量设置后，再通过 Google 登录。测速站不使用 Access 或数据库，详见 [测速站说明](../speedtest-worker/README.md)。

## 2. Google OAuth 和 Cloudflare Access

从 Cloudflare Zero Trust → Access controls → Applications 创建按域名保护的 Self-hosted 应用。这个入口也支持在 Worker 部署前配置，前提是域名属于账号内已激活的 Zone；本文采用先部署 Worker、再配置 Access 的首次引导顺序。见 [Access 应用创建说明](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)。

按 [Cloudflare Google IdP 官方步骤](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)在 Google Cloud 配置 OAuth consent screen、Web OAuth client 和 Cloudflare 回调地址，再把 client ID/secret 配置到 Cloudflare Access 的 Google identity provider。测试模式的 Google OAuth 应用需加入允许登录的测试用户。

建立一个 self-hosted Access application，将以下 Public hostname 加入同一个应用：

| 用途 | Public hostname / Path |
| --- | --- |
| 根路径统一网页与默认保护，包含 `/api/*` | `atlasrouter.zslab.ai`，Path 留空 |
| 个人、管理 API（可在同一应用中显式添加） | `atlasrouter.zslab.ai/api` |

应用策略允许所需用户邮箱或组织，登录方式仅启用 Google。普通用户和管理员都直接打开 `https://atlasrouter.zslab.ai/`，Worker 根据 `ADMIN_EMAILS` 在同一页展示相应功能；每次管理 API 调用还会校验邮箱白名单，普通用户即使直接调用也会收到 403。

不要只保护 HTML 页面而漏掉 API 子路径。如果已经按之前的说明建立了独立的用户、管理员应用，先将这些路径合并到同一个应用，取消旧应用的重叠路径，并使用统一的 AUD。单个应用可包含多个受保护地址，见 [Cloudflare Access 会话说明](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)。

再建立用于订阅路径的 self-hosted Access application，策略选 `Bypass`、Include 选 `Everyone`，Public hostname 设置为 `atlasrouter.zslab.ai/AtlasRouter`。该路径及其 `/modules/*`、`/rules/*` 用于客户端定时更新，直接到达 Worker 后仍必须通过订阅 token 鉴权。当前版本不需要为 `/atlasrouter`、`/atlas-router` 或 `/modules` 另设兼容入口。

浏览器 API 位于 `/api/account/*` 和 `/api/<slug>/pool/*`，与订阅 Bypass 路径分开。不要给整个域名或 `/api` 配置 Bypass。根路径的默认保护已覆盖 `/api`，显式添加 API 路径时仍使用同一个主应用及 AUD，无需把真实随机标识填入 Access 配置。旧网页、旧 API 和旧订阅到达 Worker 后均返回 404。Access 路径会覆盖子路径，较具体的路径优先，见 [Cloudflare Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)；Worker 同时按 [官方说明](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)校验 JWT。

## 3. Worker 运行配置

在 Worker 的 Variables and Secrets 设置：

```text
ACCESS_TEAM_DOMAIN=https://<team>.cloudflareaccess.com
ACCESS_AUD=REPLACE_WITH_APPLICATION_AUD
```

这两个值使用普通变量。Worker 另使用两个 Secret：

- `ADMIN_EMAILS`：手动设置，内容为逗号分隔的管理员邮箱。
- `ADMIN_API_SLUG`：由 `npm run deploy` 自动生成的 32 位小写十六进制标识，每次部署轮换；仅管理员页面会拿到对应接口路径。

无需手动生成或填写 `ADMIN_API_SLUG`。部署脚本会通过 [Wrangler `--secrets-file`](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code) 将新标识与代码一同发布，同时保留未涉及的 Secrets。空值、缺失值或误删后的下一次部署也会得到新标识。部署后刷新已打开的管理员页面，订阅链接和分配关系不变。

绕过该脚本直接运行 `wrangler deploy` 不会执行自动轮换。运行时缺失或格式不正确的标识仍会关闭管理功能，避免退回固定路径；重新运行 `npm run deploy` 即可修复。随机路径不能替代身份和权限校验，详见 [env.md](env.md)。

旧的 `ACCESS_USER_AUD` 已不再使用，可移除。不要在生产设置用于离线测试的 `ACCESS_JWKS_JSON`。

Google client secret 留在 Access 的 IdP 设置中；节点配置通过管理页写入 D1。不要将它们写入 Wrangler 配置、GitHub 仓库或构建日志。`keep_vars` 会保留 Dashboard 的普通变量。部署脚本只覆盖 `ADMIN_API_SLUG`，其余既有 Secrets 会被保留。

## 4. GitHub CI/CD

在 GitHub 仓库分别创建 `development`、`production` Environment，各自设置部署 Secrets：

- `CLOUDFLARE_API_TOKEN`：使用 Cloudflare 的 Edit Cloudflare Workers 模板创建、限制到目标账号和 `zslab.ai` Zone，并确认含有 Account → D1 → Edit 权限，以执行数据库迁移。
- `CLOUDFLARE_ACCOUNT_ID`：目标 Cloudflare Account ID。

两个 Environment 分别限制为 `develop`、`master` 分支，生产凭据不要放在仓库级 Secrets，也不要给开发环境复制生产运行时 Secrets。开发、生产部署使用独立并发队列，正在执行的迁移或部署不因新提交被中断。GitHub Environment 的分支限制和 Secret 隔离需要在仓库设置中实际配置，仅添加工作流文件不会自动完成这些设置。参见 [GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)。

PR、`develop` 和 `master` 都运行 `npm ci`、`npm test`、`npm run build:dev` 和 `npm run build:speedtest`。验证任务不使用部署 Secrets。`develop` 验证成功后只执行 `npm run deploy:dev`；`master` 才执行生产的 `npm run deploy`。手动 `workflow_dispatch` 同样根据所选 Git 分支选择环境，其他分支只验证。开发测试完成后，通过 PR 将 `develop` 合入 `master` 发布生产。

如果仓库仍以 `main` 为默认分支，需在获得 Git 操作授权后建立 `develop` 和 `master`，并将默认分支调整为 `master`；本工作流不会从 `main` 发布生产。建议将 `verify` 设为 `master` 的必需状态检查。若原项目启用了 Cloudflare Workers Builds 自动部署，应停用那条部署触发器，避免双重发布和绕过 GitHub 检查。

开发首次初始化时，使用 `wrangler.dev.jsonc` 中独立的数据库 ID。为 `atlasrouter-dev.zslab.ai` 创建独立 Access 应用，按上文配置根路径和 `/api`，再为该域名的 `/AtlasRouter` 及子路径建立订阅 Bypass。在开发 Worker 上设置它自己的 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 和 `ADMIN_EMAILS`；管理路径由开发部署脚本自动生成。复用 Google IdP 可以，但不要复用生产应用的 AUD。缺少 Access 设置时页面不会开放；新库没有节点时订阅返回等待分配。

本地构建检查无需账号凭据：

```sh
cd worker
npm run build
npm run build:dev
npm run build:speedtest
```

手动部署（需要自己的 Cloudflare 凭据）：

```sh
cd worker
npm run deploy
```

参考：[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[GitHub Node.js CI](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)。

## 5. 首次使用与验收

1. 管理员打开 `https://atlasrouter.zslab.ai/`，通过 Google 登录，同一页会显示个人订阅和节点池管理。
2. 粘贴带国旗与 IDC/ISP/WARP 关键词的 Surge 节点，点击“加入待保存清单”，再点击“保存并分配”。
3. 普通用户也打开同一个 URL，登录后看到自己的订阅，复制 `/AtlasRouter?token=<token>` 专属链接到 Surge；无浏览器登录会话也能更新，缺少 token 则返回 401。
4. 用三个测试邮箱和同组三个测试节点检查主节点不同、主备顺序循环；增加到六个用户时，检查共享主节点且同一主节点下用户的第一备用节点不同。核对 Surge 地区组按此顺序生成 Smart 系数 1、2、3，Clash 地区组为同顺序的 fallback。Clash 模拟一个节点失效时，其两个用户应分别切换到另外两个可用节点；Surge Smart 的实际选择还受连接表现影响。
5. 管理页检查每个节点的用户邮箱、当前人数、累计次数和配置详情；测试重置链接后旧 token 返回 401。

代码测试使用临时身份、公钥和 `.example.com` 节点，不能代替真实 Google OAuth、Access 边缘路径配置和 Surge 客户端导入验收。

上线后可手动执行不带凭据的安全探测：

```sh
cd worker
npm run check:live-security -- https://atlasrouter.zslab.ai
```

也可把 `ATLAS_ROUTER_BASE_URL` 放在本地 `worker/.env`，再运行 `npm run check:live-security`。更多验收步骤见 [security-pentest.md](security-pentest.md)。
