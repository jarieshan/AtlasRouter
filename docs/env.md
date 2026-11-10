# Worker 环境与存储

当前使用同一 Worker 的生产环境和原生 Preview；配置入口是 [wrangler.jsonc](../worker/wrangler.jsonc)。Cloudflare 接入步骤见 [部署说明](deployment-cloudflare.md)，域名、路径和数据流见 [原生预览方案](native-previews.md)。`dev=1` 不再用于当前入口切换分支代码。

## 运行时配置

| 配置 | 生产 | `develop` Preview |
| --- | --- | --- |
| `DB`（D1 binding） | `atlas-router` 正式库 | `atlas-router-dev` 测试库 |
| `DEV_DB`（D1 binding） | 测试库，仅供生产 UI 管理测试数据 | 不绑定 |
| `UI_ENABLED`（变量） | `true` | `false`，根页面返回 404 |
| `SUBSCRIPTION_PATH`（变量） | `/AtlasRouter` | `/AtlasRouter-Dev` |
| `DEV_SUBSCRIPTION_ORIGIN`（变量） | 开发预览的固定 HTTPS origin | 不需要 |
| `SMART_PRIORITY_SCHEME`（变量） | 不读取，不启用权重实验 | develop 源码使用 `geometric-10`：1、10、100、1000…；ISP 组的备用节点从 100 起：1、100、1000、10000… |
| `SHOW_ALL_PROXY_GROUPS`（变量） | 不启用，使用模板中的可见性设置 | `true`，统一移除所有策略组的隐藏属性，Surge / Clash 全部可见 |

`geometric-10` 按每位用户的主节点、备用节点顺序赋权。按 [Surge Smart 组说明](https://kb.nssurge.com/surge-knowledge-base/guidelines/smart-group)，系数乘在节点的延迟上，大于 1 即降低优先级。ISP 组的备用节点从 100 起（`geometric-10-from-100`），主节点出现故障或明显变慢时才会换到备用节点；WARP、IDC 组仍为 1、10、100…。受安全整数校验限制，最后一个系数最大为 `10^15`：普通组最多 16 个节点，ISP 组最多 15 个，超过后订阅生成会报错。

两库 ID 必须不同；Preview 的 `DB` 与生产 UI 的 `DEV_DB` 指向同一个测试库。`DEV_SUBSCRIPTION_ORIGIN` 不能带用户信息、路径、查询或片段，且必须与生产 origin 不同。`environment=development` 仅让生产 UI 及其 API 选择测试库，不转发订阅请求，也不执行另一个分支的代码。测试库结构必须与生产管理页面兼容。

上述变量来自各分支的仓库配置。master 固定生成顺序 fallback，不读取遗留的 `SMART_PRIORITY_SCHEME`；develop 源码和 Preview 配置独立，继续试验 Smart 权重。完整差异见 [兼容性核对](client-compatibility.md)。

生产网页和浏览器 API 还需要以下配置。Preview 默认关闭 UI，订阅只依赖测试 D1 中的个人 token；若另行启用 Preview 浏览器 API，须明确配置其 Access 参数，不能依赖生产 Secrets 自动继承。

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | 普通变量 | Access team origin，例如 `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | 普通变量 | 统一网页与 API 的 Access application Audience |
| `ADMIN_EMAILS` | Secret | 允许管理配置的邮箱，英文逗号分隔 |
| `ADMIN_API_SLUG` | Secret | 密码学随机生成的 32 位小写十六进制管理路径标识 |
| `PREVIEW_EMAIL_HASHES` | 可选 Secret | 测试邮箱规范化后的 SHA-256 摘要，英文逗号分隔 |

`PREVIEW_EMAIL_HASHES` 是只读的**页面演示身份**，与原生 Worker Preview 和 Dev 数据环境不同。匹配身份只查看启用节点的展示信息，模拟操作保留在页面内存，不注册正式用户、不获取有效订阅，也不写入分配记录。

同一个 Access application 保护生产 `/` 及 `/api/*`；订阅路径及其子路径使用精确 Bypass，再由 Worker 校验个人 token。Google OAuth client ID/secret 配置在 Access 身份提供商中。Worker 不处理 Google client secret；`ACCESS_JWKS_JSON` 仅供离线测试，生产不设置。旧 `ACCESS_USER_AUD`、KV binding 和组合构建的 `DEV_ADMIN_*` 不属于当前配置。

节点凭据通过受保护管理页面录入 D1，不放在普通环境变量或代码中。D1 读取权限视为敏感数据读取权限。构建凭据由 Workers Builds 管理，其 token 需有 D1 Edit 权限以迁移开发库；GitHub Actions 只验证代码和 MagicRule 公开清单，不需要 Cloudflare Secrets。构建变量与 Worker 运行时变量分开配置，个人订阅 token 不放入构建变量。

## 本地配置与发布命令

本地 `.dev.vars*`、`.env*`、`local-private/`、Wrangler 状态、依赖和生成资源由 [.gitignore](../.gitignore) 排除。可把仅含占位域名的 [env.example](../worker/env.example) 复制为 `worker/.env`，供只读线上检查使用；这不是云端部署前置步骤，不提交真实值。

- `npm test`：单元测试、构建和本地运行时测试。
- `npm run build`：当前源代码的 Wrangler dry-run，不发布。
- `npm run deploy:preview -- --dry-run`：只校验 Preview 发布配置。
- `npm run deploy:preview`：仅允许 `develop`；迁移测试库后发布固定的 `develop` Preview。
- `npm run deploy`：只允许 Cloudflare Workers Builds 的 master 构建执行；先迁移两库，再发布生产 UI 和稳定分流代码。本地运行会拒绝发布。

Cloudflare 生产 Deploy command 使用 `npm run deploy`。旧 `build:branches`、`deploy:branches`、`setup:builds` 不用于当前流程。发布只由 Cloudflare 监听 Git 推送触发；不从本机手工部署，也不通过 GitHub Actions 发布。

## D1 关系表

数据库结构见 [0002_relational.sql](../worker/migrations/0002_relational.sql) 和 [0003_magic_rule_sets.sql](../worker/migrations/0003_magic_rule_sets.sql)。运行时不保存 JSON 快照：

| 表 | 用途与主要字段 |
| --- | --- |
| `users` | 用户 ID、唯一规范化邮箱、唯一订阅 token、启用状态、创建时间、注册顺序 |
| `nodes` | 节点 ID、唯一名称、地区、IP 类型、组名、Surge 配置值、启用状态、历史分配次数、首次分配时间、录入顺序 |
| `assignments` | 用户 ID、组名、主节点 ID、同一主节点内的分配顺序；`(user_id, group_name)` 为主键 |
| `store_versions` | 节点池的写入版本、事务标识和管理员清单版本 |
| `magic_rule_sets` | MagicRule 规则名、客户端、内容 SHA-256、最后一次通过校验的公开规则内容和写入时间；`(name, client)` 为主键，不含用户数据 |

外键保证归属引用有效用户及同组节点，唯一约束保证每人每组最多一个主节点；多个用户可引用同一节点。当前分配人数由 `assignments` 统计，历史次数保存在 `nodes.assignment_count`。固定录入顺序与 `owner_order` 共同决定主备顺序，不保存重复的备用节点列表。

多表更新使用 D1 `batch()` 事务和版本条件；冲突后重新读取和计算，只写入变化的用户、节点及归属记录。管理清单版本用于拒绝过期编辑。普通订阅按 token 索引查询，账号按邮箱索引查询。具体限制和分配策略见 [多用户与节点池](multi-user.md)。

## 管理路径与节点配置

管理员只需打开根路径。Worker 验证管理员邮箱后将随机管理路径注入 HTML；普通用户页面和个人 API 不包含该值。随机路径不能替代 Access JWT、邮箱白名单和同源写入检查。

master 构建在两库迁移成功后自动生成新的 `ADMIN_API_SLUG`，通过权限受限的临时 Secrets 文件与代码一同发布。发布后旧路径失效，管理员页面需要刷新；其他 Secrets、个人 token 和节点分配保持。Preview 发布不轮换生产标识，也不需要 `DEV_ADMIN_API_SLUG`。

节点只从根路径管理区域录入，格式为 `节点名 = Surge 节点配置`。国家旗帜和 `IDC`、`ISP`、`WARP` 决定分组，完整约定见 [multi-user.md](multi-user.md)。保存时提交 `{ revision, nodes: [{ id, line, enabled }] }`，Worker 拆入节点和分配关系表。

旧手动订阅、手动配置页面与证书生成均已移除，订阅不包含 MitM 配置。已执行的历史迁移保持不变；迁移留下的 `manual_*` 表及手动配置版本行不会被当前 Worker 读写。本次下线功能不删除历史数据。
