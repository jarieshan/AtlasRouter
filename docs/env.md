# Worker Env

AtlasRouter 每个环境使用一个存储绑定：

- `DB`：Cloudflare D1 SQLite。生产使用 `wrangler.jsonc`，开发使用 `wrangler.dev.jsonc`，分别填写独立数据库 ID，再应用 `worker/migrations/` 中的 SQL 迁移创建关系表。开发节点、用户、订阅 token 和分配关系独立保存，不复制生产数据。

节点凭据由管理员通过受保护页面录入存储，不放入代码或普通环境变量。D1 读权限视为敏感配置读取权限。GitHub Actions 仅保存部署所需的 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` Secrets，不保存节点或用户订阅 token；部署 token 需要 D1 Edit 权限。旧 `SUBSCRIPTIONS` 和 `ATLAS_ROUTER` binding 已移除。

同一个 Cloudflare Access 应用保护域名根路径 `/` 及 `/api` 下的全部 API。所有用户直接访问域名，Worker 校验 Access 注入的 JWT 后按邮箱决定是否展示管理功能。`/AtlasRouter` 订阅入口及其模块、Clash 规则集路径需绕过交互式 Access 登录，由 Worker 校验订阅 token；具体路径优先级见 [部署说明](deployment-cloudflare.md)。需要在 Cloudflare Dashboard 的 Worker Variables and Secrets 中配置：

- `ACCESS_TEAM_DOMAIN`：普通变量，Cloudflare Access team domain，例如 `https://<team>.cloudflareaccess.com`。
- `ACCESS_AUD`：普通变量，统一 Access application 的 Audience (AUD)，网页、个人 API 和管理 API 都使用它。
- `SMART_PRIORITY_SCHEME`：可选普通变量，省略或 `linear` 使用个人主备位置 1、2、3…；`geometric-3` 使用 1、3、9、27、81…。当前仅开发配置显式启用后者，不能由订阅查询参数修改；Clash 对这两种生成格式均保留顺序并输出 fallback。权重必须能表示为安全整数，过大的分组会拒绝生成，避免输出无效数值。
- `ADMIN_EMAILS`：Secret，允许管理配置的邮箱，多个邮箱用英文逗号分隔。
- `ADMIN_API_SLUG`：Secret，用密码学随机数生成的 32 位小写十六进制标识，组成 `/api/<slug>/pool/*` 管理路径。每次 `npm run deploy` 自动生成并写入；绕过部署流程导致缺失或格式错误时，管理功能关闭。
- `PREVIEW_EMAIL_HASHES`：可选 Secret，测试邮箱去除首尾空白并转小写后的 SHA-256 十六进制摘要，多个摘要用英文逗号分隔。匹配的身份从普通首页自动进入页面预览，只读展示 D1 中启用节点的 ID、名称和分组，不能注册正式用户或读取正式订阅。只保存识别摘要，不写入测试账号、节点变更、分配或操作记录；摘要不返回给浏览器。

如果曾配置独立的用户/管理员 Access 应用，需将两组路径并入同一个应用，更新 `ACCESS_AUD`，移除已不再使用的 `ACCESS_USER_AUD`。同一个登录会话即可使用个人功能及其有权访问的管理功能。

Google OAuth client ID/secret 配置在 Cloudflare Access 身份提供商中，Worker 不处理 Google client secret。`ACCESS_JWKS_JSON` 仅用于离线测试注入公钥，生产不要设置；生产从 team domain 获取 Access 公钥。真实账号、密钥与本地 `.dev.vars*`、`.env*` 均不入库。

`develop` 和 `master` 分别使用 GitHub 的 `development`、`production` Environment。两端独立配置以上运行时变量和 Secrets；特别是 Access AUD、管理路径及订阅 token 不能通用。GitHub Environment 内仅放对应环境的 Cloudflare 部署凭据，部署脚本的 `--development` 只操作开发配置。

## D1 关系表

数据库结构见 [0002_relational.sql](../worker/migrations/0002_relational.sql)。运行时不保存 JSON 快照：

| 表 | 用途与主要字段 |
| --- | --- |
| `users` | 用户 ID、唯一规范化邮箱、唯一订阅 token、启用状态、创建时间、注册顺序 |
| `nodes` | 节点 ID、唯一名称、地区、IP 类型、组名、Surge 配置值、启用状态、历史分配次数、首次分配时间、录入顺序 |
| `assignments` | 用户 ID、组名、主节点 ID、同一主节点内的分配顺序；`(user_id, group_name)` 为主键 |
| `store_versions` | 节点池的写入版本、事务标识和管理员清单版本 |

外键保证归属引用有效用户及同组节点，唯一约束保证每人每组最多一个主节点；多个用户可引用同一节点。当前分配人数由 `assignments` 统计，历史次数保存在 `nodes.assignment_count`。固定录入顺序与 `owner_order` 共同决定主备顺序，不保存重复的备用节点列表。

多表更新使用 D1 `batch()` 事务和版本条件；冲突后重新读取和计算，只写入变化的用户、节点及归属记录。管理清单版本用于拒绝过期编辑。普通订阅按 token 索引查询，账号按邮箱索引查询。具体限制和分配策略见 [多用户与节点池](multi-user.md)。

## 管理路径与节点配置

管理员仍只需打开根路径。Worker 在核验管理员邮箱后，将随机管理路径注入 HTML；普通用户页面和个人 API 不包含此值。随机路径仅减少常见路径扫描命中，不能替代 Access JWT、邮箱白名单和同源写入检查。不要使用 `admin` 或邮箱的固定哈希作为标识，不要把真实值提交到仓库。

在 `worker` 目录执行 `npm run deploy` 时，部署脚本会在 D1 迁移成功后生成新标识，通过 Wrangler `--secrets-file` 与代码一同发布。首次部署、已有值、空值或误删后的下一次部署都采用同一流程，无需手动填写，也不需要配置对应的 GitHub Secret。其他 Worker Secrets 保持不变，参见 [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code)。

每次发布后旧路径停止服务，已打开的管理员页面需要刷新。订阅 token 和用户分配不受影响。构建或数据库迁移失败时，不会提前修改线上标识；运行时不会按请求或实例随机生成。若运行中误删该 Secret，重新执行部署即可修复。

脚本使用权限受限的临时 JSON 文件传递 Secret，结束后删除，并隐藏输出中的随机值。可运行 `npm run deploy -- --dry-run` 验证上传流程；此模式不执行远程迁移或发布。本地开发仍在被忽略的 `.dev.vars` 中设置独立测试值。

节点只从根路径管理区域录入，格式为 `节点名 = Surge 节点配置`。国家旗帜和 `IDC`、`ISP`、`WARP` 决定分组，完整约定见 [multi-user.md](multi-user.md)。保存时提交 `{ revision, nodes: [{ id, line, enabled }] }`，Worker 拆入节点和分配关系表。

旧手动订阅、手动配置页面与证书生成均已移除，订阅默认关闭 MitM。已执行的历史迁移保持不变；迁移留下的 `manual_*` 表及手动配置版本行不会被当前 Worker 读写。本次下线功能不删除历史数据。
