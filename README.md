# AtlasRouter

AtlasRouter 是基于 Cloudflare Workers 的多用户 Surge 配置订阅系统，集中维护分流规则、模块和节点池。

用户通过 Cloudflare Access + Google 登录，以验证后的邮箱识别账号，在个人页面获取专属订阅链接。管理员录入节点后，系统按地区/IP 类型分组，为每个用户分配各组主节点，并生成均衡轮转的备份顺序。节点不足时允许共享主节点。

用户、节点与分配关系分别保存在 Cloudflare D1 SQLite 的 `users`、`nodes`、`assignments` 表中；不保存 JSON 快照，也不再提供旧版手动订阅或兼容入口。节点信息、订阅凭据不写入仓库。

## 当前状态

已实现登录、自动分配和订阅生成。Dev 开关在当前页面切换独立测试节点与开发版配置，不跳转或整页刷新；关闭时使用正式订阅。开发订阅通过同一域名的 `/AtlasRouter-Dev` 调用私有开发 Worker，原生预览和独立测试域名保持关闭。配置见 [部署说明](docs/deployment-cloudflare.md)。

- `README.md`：项目说明与维护入口。
- `AGENTS.md`：面向后续 LLM/Agent 协作者的仓库工作规范。
- `docs/`：设计、部署、运维和决策记录。
- `worker/`：Cloudflare Worker 订阅服务。
- `surge/`：Surge 主配置模板。
- `modules/`：Surge 模块。
- `references/`：历史配置和样例，仅用于理解已有想法，不作为事实来源或实现依据。

## 目标组成

后续实现可以按下面的职责拆分，具体目录以实际代码为准：

- `worker/`：Cloudflare Worker 订阅入口、鉴权、节点注入、配置渲染。
- `surge/`：Surge 主配置模板、策略组定义和规则配置。
- `modules/`：Surge `.sgmodule` 模块。
- `scripts/`：Surge 脚本与相关说明。
- `docs/`：架构说明、部署流程、配置约定和变更决策。
- `references/`：非权威参考材料，避免被生产逻辑直接依赖。

## 订阅生成流程

```mermaid
flowchart LR
  A["Google / Cloudflare Access"] --> B["用户页：按邮箱获取订阅链接"]
  C["管理员录入节点"] --> D["D1：归属、计数与均衡分配"]
  B --> D
  E["Surge 携带个人 token"] --> F["Worker 校验订阅凭据"]
  F --> D
  D --> G["渲染模板与按主备顺序排列的 fallback 组"]
  G --> H["Surge 导入 / 更新；客户端检测故障"]
```

## 维护原则

1. 节点、Token、上游订阅链接等敏感信息不提交到 Git。
2. `references/` 中的内容只能帮助理解方向；实现前以仓库代码、当前需求和官方文档为准。
3. Surge 规则保持可解释的顺序：越具体的规则越靠前，兜底规则放最后。
4. Worker 中的订阅鉴权、路径分发和错误响应要保持简单明确。
5. 新增规则、策略组或模块时，同步更新说明，避免配置和文档漂移。

## 本地验证

```sh
cd worker
npm ci
npm test
```

使用 Node.js 24。`npm test` 包括单元测试、部署构建检查和 Miniflare/workerd 集成测试，覆盖本地 D1 的并发分配与重启持久化。测试、构建和部署前会将 `surge/` 和 `modules/` 中的静态资产打包进 Worker。

统一网页入口为域名根路径 `/`，订阅链接为 `/AtlasRouter?token=<token>`。普通用户看到个人订阅，管理员在同一页还可管理节点池和用户；角色由验证后的邮箱及 `ADMIN_EMAILS` 决定。个人 API 位于 `/api/account/*`，管理 API 位于 `/api/<slug>/pool/*`；随机标识由 `ADMIN_API_SLUG` Secret 提供，仅注入管理员页面；每次 master 构建发布会轮换该 Secret，发布后需刷新已打开的管理员页面。`/admin`、`/api/admin/*` 和旧订阅等入口均已停用，到达 Worker 后返回 404。完整部署步骤见 [Cloudflare 部署](docs/deployment-cloudflare.md)，分配规则见 [多用户与节点池](docs/multi-user.md)。

页面默认启用 DoH，可关闭 DoH 或切换 Client（默认 Surge / Clash），分别通过 `doh=0`、`client=clash` 注入订阅链接。腾讯公司内网的系统代理例外已写入默认 `skip-proxy`，无需安装模块或添加订阅参数。Clash / Mihomo 输出由同一份完整 Surge 配置转换，自动跳过不兼容内容，不需要维护两份分流配置。参数与兼容范围见 [订阅说明](docs/subscription.md)。

线上安全探测需要手动执行，不属于默认测试：

```sh
cd worker
npm run check:live-security -- https://<worker-domain>
```

也可以把目标域名放在本地 `worker/.env` 的 `ATLAS_ROUTER_BASE_URL` 中，然后直接运行 `npm run check:live-security`。检查随机管理 API 还需在环境中提供 `ADMIN_API_SLUG`，否则脚本明确跳过该部分；输出会遮蔽随机路径。可参考仅含占位值的 [env.example](worker/env.example)。`.env*`、`local-private/`、依赖、Wrangler 状态和生成资源已被 Git 忽略，不应入库。

完整安全测试流程见 `docs/security-pentest.md`。

## 发布边界

正式 `atlas-router` Worker 提供页面及正式订阅；私有 `atlas-router-development` Worker 只提供开发订阅。生产由 master 构建发布，开发服务使用 `npm run deploy:development`；原生 Preview Builds 保持关闭。

页面默认读写正式 `DB`，开启 Dev 后仅管理独立 `DEV_DB`，生成同域名 `/AtlasRouter-Dev` 订阅。两套用户、凭据和节点独立；香港和洛杉矶的 Access + Tunnel 入口不参与环境切换。

生产分流基线见 [生产基线](docs/production-baseline.md)，部署步骤见 [部署说明](docs/deployment-cloudflare.md)，历史下线记录见 [预览下线](docs/native-previews.md)。

## Cloudflare Worker 配置约定

实际变量名由 Worker 实现决定，但应遵守以下边界：

- 通过 `DB` binding 使用正式 D1，节点池使用 `users`、`nodes`、`assignments` 表，分配更新通过版本检查和多表事务提交。D1 读取权限视为敏感配置读取权限；不再需要 KV 或 Durable Object binding。
- 网页及 API 由同一个 Cloudflare Access + Google 应用保护，Worker 校验 JWT；管理操作还校验管理员邮箱白名单。
- `ADMIN_EMAILS`、`ADMIN_API_SLUG` 使用 Worker Secret；Google OAuth 客户端密钥配置在 Cloudflare Access 身份提供商中。
- 本地开发时不要提交 `.dev.vars*`、`.env*` 或任何真实节点信息。
- Worker 代码应从 `fetch(request, env, ctx)` 的 `env` 参数读取绑定，避免硬编码。

## Surge 配置约定

- master 自动订阅的 `[Proxy Group]` 使用 `surge/pool-groups.conf`，动态生成如 `🇺🇸USA-ISP`、`🇭🇰HK-IDC`、`🇸🇬SG-WARP` 的顺序 `fallback` 组；Surge / Clash 均保留个人主备次序，间隔 300 秒。Smart 权重仅在 develop 分支实验；原有 Auto Smart 组仍保留。
- `[Rule]` 负责流量匹配，规则按文件顺序从上到下匹配，并以 `FINAL` 规则兜底。
- 外部策略可通过 `policy-path` 引入，区域筛选可用 `policy-regex-filter`。
- 模块文件用于对主配置做局部覆盖或追加，不应承担主配置无法解释的大段逻辑。

## 官方文档

- [Surge Manual](https://manual.nssurge.com)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers)
