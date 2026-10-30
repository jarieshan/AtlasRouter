# Cloudflare Deployment

目标是一个 `atlas-router` Worker、一个域名、两份 Git 分支代码和两个 D1 数据库。Cloudflare Workers Builds 直接监听 GitHub 的 `master`、`develop` 推送；GitHub Actions 只验证代码，不触发部署，也不需要 Cloudflare Secrets。

| 请求 | 执行的代码 | D1 binding / 数据库 |
| --- | --- | --- |
| 无 `dev` 参数，或 `dev=0` | `master` | `DB` / `atlas-router` |
| `dev=1` | `develop` | `DEV_DB` / `atlas-router-dev` |

网页也按相同参数选择环境：正式入口 `/`，开发入口 `/?dev=1`。开发订阅使用 `/AtlasRouter?token=<dev-token>&dev=1`。参数不会绕过鉴权，生产 token 不能访问开发库，开发 token 也不能访问生产库。重复或非法 `dev` 参数返回 400。

**接入状态：**单 Worker 分发、独立 D1 和不同分支转换代码已在本地 workerd 验证，尚未启用线上双分支部署。接入时发现现有 `master` 仍是旧 KV/手动订阅版本，与线上 D1 应用不一致；必须先将它对齐到经过核对的线上源码基线，再加入分支入口协议，不能直接用旧 `master` 覆盖线上。当前 Cloudflare 凭据调用 Builds API 返回 403，GitHub 连接及双分支触发器还需在 Cloudflare 配置。仓库中的配置文件不会自行创建触发器。

## 1. 构建与存储

使用 Node.js 24，在 `worker/` 目录执行：

```sh
npm ci
npm test
npm run build:branches
npm run deploy:branches -- --dry-run
```

`build:branches` 获取两个远程分支的确定提交，各自在临时目录安装锁定依赖、生成静态资产并运行测试，再分别编译 `src/index.js`。因此两个分支可以使用不同的订阅转换实现、模板和依赖。最后将两份模块和公共入口打包成一个 Worker；请求时按参数加载对应模块。`references/` 不参与构建。

`build:branches -- --local` 改用本地已提交的 `master` / `develop`，不会包含工作区未提交改动。两个分支都必须保留 `worker/branch-runtime.json`、D1 迁移和 `fetch(request, env, ctx)` 接口；该文件声明应用支持 D1 和 `dev` 参数的完整传播。缺失协议可以构建检查，但不能部署。

产物在被 Git 忽略的 `.wrangler/branches/`：包括组合入口、两个提交 SHA、构建校验信息及各自 SQL 迁移快照。构建失败不会覆盖之前成功的产物。部署使用 [wrangler.branches.jsonc](../worker/wrangler.branches.jsonc)，本地单分支开发和测试继续使用 `wrangler.jsonc`。

- `DB` 和 `DEV_DB` 必须绑定不同 D1 ID。开发节点、用户、token 和分配关系独立保存，不复制生产数据。
- 应用运行时只看到所选分支的绑定；开发环境的 `DEV_*` 去掉前缀后传入。开发配置缺失不会借用生产配置。
- 两个分支各自的 `worker/migrations/` 是对应数据库的迁移来源。历史迁移不改写；当前使用关系表，不能回退到依赖旧 `configs` 表的版本。
- Worker 使用 `atlasrouter.zslab.ai` Custom Domain，关闭 `workers.dev` 和预览 URL。域名需属于已激活的 Zone，见 [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

| 命令 | 用途 |
| --- | --- |
| `npm test` | 单元测试、构建检查和本地 workerd/D1 集成测试 |
| `npm run dev` | 迁移本地库并开发当前工作区代码 |
| `npm run build:branches` | 获取、验证并组合两个远程分支，不发布 |
| `npm run deploy:branches -- --dry-run` | 检查组合产物，不迁移或发布 |
| `npm run deploy -- --branch develop` | 构建两份代码，迁移开发 D1、轮换开发管理路径并发布组合 Worker |
| `npm run deploy -- --branch master` | 构建两份代码，迁移生产 D1、轮换生产管理路径并发布组合 Worker |

部署前校验 Worker、分支、触发提交、产物哈希和两个远程分支头。选中数据库迁移后，还会只读检查另一个数据库已应用其代码需要的迁移，并在上传前再次检查分支头；失败则不发布代码和新 Secret。如果两个分支同时新增迁移，先执行的部署可能在应用自身迁移后停止，另一分支迁移完成后才能发布。全新空库需先显式初始化其中一库，再部署另一分支；已有生产库不重复初始化。迁移须兼容仍在运行的旧代码，参见 [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。

两份代码共享一次 Worker 发布、兼容日期、资源限制和公共分发入口。它们不是安全沙箱，也不支持分别回滚；修改公共入口或 Wrangler 配置会影响两边，需要同时审查。过期构建检查不能替代发布锁，接通自动部署前应串行发布，避免两个上传相互覆盖。不同分支应用必须从传入的 `env` 获取绑定，不使用 `cloudflare:workers` 的全局 `env` 绕过分发。

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

同一域名的两种请求共享 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 和 Google 登录应用；查询参数不建立另一个边缘 Access 应用。Worker 内的管理员白名单、管理路径和数据分别配置：

| 用途 | 正式环境 | 开发环境 |
| --- | --- | --- |
| 管理员邮箱 Secret | `ADMIN_EMAILS` | `DEV_ADMIN_EMAILS` |
| 管理路径 Secret | `ADMIN_API_SLUG` | `DEV_ADMIN_API_SLUG` |
| Smart 权重普通变量 | `SMART_PRIORITY_SCHEME` | `DEV_SMART_PRIORITY_SCHEME` |
| 可选页面预览身份 Secret | `PREVIEW_EMAIL_HASHES` | `DEV_PREVIEW_EMAIL_HASHES` |

`DEV_SMART_PRIORITY_SCHEME=geometric-3` 已在组合配置中设置，开发订阅试验 1、3、9、27、81… 的 Smart 权重，Clash 仍转换为同顺序 fallback。未配置的生产参数由 `master` 自身决定，公共入口不替它修改默认值。

每次部署只生成所选分支的管理路径 Secret，通过 Wrangler `--secrets-file` 随代码发布；其他 Secrets 保留。管理路径缺失或不合法时管理功能关闭。首次接入需确保两个管理路径都已初始化；生产已有值保持，开发首次发布会生成新值。发布后只需刷新对应管理员页面，订阅 token 和用户分配不变。不要绕过脚本直接 `wrangler deploy`，否则会跳过分支、产物和迁移检查。

Google client secret 保存在 Access IdP 中；节点凭据通过对应管理页写入 D1。`keep_vars` 保留 Dashboard 普通变量。`ACCESS_JWKS_JSON` 只用于离线测试，线上不要设置。完整参数见 [env.md](env.md)。

## 4. Cloudflare Workers Builds

首次启用前，两条分支都要包含可运行的构建、部署脚本和入口协议；应用代码可以继续各自演进。先核对 `master` 与线上源码基线，保留生产发布暂停状态，完成下面的连接准备后再启用自动部署。

1. 在已有 `atlas-router` 的 Settings → Builds → Connect 连接 GitHub，授权 Cloudflare GitHub App 访问仓库。
2. 选择同一个 Worker 的普通部署触发器，根目录设为 `worker`，Node.js 由 `.nvmrc` 固定为 24。关闭 Preview Builds。
3. 普通触发器的 `branch_includes` 配置为 `["master", "develop"]`。如果 Dashboard 只允许选一个 Production branch，通过官方 Builds API 更新该普通触发器；不要另建开发 Worker。
4. 构建命令使用 `npm ci && npm run build:branches`，部署命令使用 `npm run deploy:branches`。脚本从 `WORKERS_CI_BRANCH` 读取触发分支。Build Variables 可设 `SKIP_DEPENDENCY_INSTALL=1` 避免重复安装。

API 更新请求的正文已保存在 [builds.branches.json](../worker/builds.branches.json)，供 `PATCH /accounts/<account-id>/builds/triggers/<trigger-id>` 使用。它只包含监听分支和命令，不包含凭据或 GitHub 连接信息。官方 `branch_includes` 支持分支模式数组；本仓库尚未完成账号上的双分支触发实测。接口和所需权限见 [Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/)及 [更新触发器](https://developers.cloudflare.com/api/resources/workers_builds/subresources/triggers/methods/update/)。

配置 Builds API 的用户 token 需要 **Workers Builds Configuration Edit** 权限；构建时使用的部署 token 还需 **D1 Edit** 和 Worker 部署权限。Cloudflare 默认生成的构建 token 不包含 D1 Edit，需选择合适的用户 token。凭据只存 Cloudflare，不填入 GitHub、仓库或聊天。具体权限、构建变量与名称覆盖机制见 [Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

Cloudflare 不等待 GitHub Actions；`build:branches` 自己在两份提交上运行测试，任一失败都不会部署。GitHub 的 [检查工作流](../.github/workflows/worker.yml) 继续验证 PR、`develop` 和 `master`。无需设置 GitHub Environment 或部署 Secrets，也不必为监听这两个分支而更改 GitHub 默认分支。

## 5. 首次使用与验收

1. 开发管理员打开 `https://atlasrouter.zslab.ai/?dev=1`，登录后录入单独的测试节点；不要导入生产库。
2. 复制开发订阅，确认 Surge 托管更新、模块及 Clash 规则集 URL 都带 `dev=1`；切换客户端、DoH 或轮换 token 后参数仍保留。
3. 缺少 token 应返回 401；开发 token 去掉 `dev=1`、生产 token 加上 `dev=1` 均应返回 401；不存在路径返回 404。
4. 修改 `develop` 的转换实现并推送，确认 Cloudflare 自己触发构建；开发输出更新，正式输出和生产数据保持原状。再分别核对 `master` 的发布与构建失败场景。
5. 核对开发 Surge Smart 权重、Clash fallback 和真实客户端导入。自动化测试使用临时身份和 `.example.com` 节点，不能代替 Google OAuth、Cloudflare 触发器和真实线路验收。

线上无凭据安全探测见 [security-pentest.md](security-pentest.md)。生产暂停期间只做本地验证，不执行上述发布验收。
